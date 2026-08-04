import {
  buildActivityResult,
  dayRangeUtc,
  filterCommitsByRange,
  formatPullRequestActivity,
  mergePullRequestGroups,
  normalizeToken,
} from "./githubActivity.mjs";
import { isExcludedCommit, parseExcludePatterns } from "./commitFilters.mjs";
import { ProviderError } from "./providerError.mjs";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function repositoryBranches(repo, token, fetchImpl, signal) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/branches?per_page=100`,
    { headers: headers(token), signal },
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new ProviderError("github", `GitHub branches request failed for ${repo}.`);
  }
  const branches = await response.json();
  return branches.map((branch) => branch?.name).filter(Boolean);
}

export async function collectGithubActivity({
  token: suppliedToken,
  repos,
  date,
  author,
  since: suppliedSince,
  until: suppliedUntil,
  signal,
  fetchImpl = fetch,
  excludeCommitPatterns = "",
  repoFilters = {},
}) {
  const token = normalizeToken(suppliedToken);
  if (!repos?.length) throw new Error("Select at least one repository.");
  if (!date) throw new Error("Choose a date.");
  const explicit = Boolean(suppliedSince && suppliedUntil);
  const range = explicit
    ? { since: suppliedSince, until: suppliedUntil }
    : dayRangeUtc(date);
  const params = new URLSearchParams({ ...range, per_page: "100" });
  if (author?.trim()) params.set("author", author.trim());

  const commitResults = await Promise.all(repos.map(async (repo) => {
    const branches = await repositoryBranches(repo, token, fetchImpl, signal);
    const branchCommits = await Promise.all((branches.length ? branches : [undefined]).map(async (branch) => {
      const branchParams = new URLSearchParams(params);
      if (branch) branchParams.set("sha", branch);
      const response = await fetchImpl(`https://api.github.com/repos/${repo}/commits?${branchParams}`, { headers: headers(token), signal });
      if (!response.ok) { await response.text().catch(() => ""); throw new ProviderError("github", `GitHub commits request failed for ${repo}.`); }
      return response.json();
    }));
    const seen = new Set();
    const commits = branchCommits.flat().filter((item) => {
      if (!item?.sha || seen.has(item.sha)) return false;
      seen.add(item.sha);
      return true;
    });
    const patterns = parseExcludePatterns(excludeCommitPatterns, repoFilters[repo]);
    return {
      repo,
      commits: (explicit ? filterCommitsByRange(commits, range) : commits)
        .filter((item) => !isExcludedCommit(item.commit?.message, patterns)),
    };
  }));
  const prGroups = await fetchPullRequests({
    token, date, author, range: explicit ? range : undefined, fetchImpl, signal,
  });
  return buildActivityResult({ date, repos, commitResults, prGroups });
}

async function searchPullRequests({
  token, date, author, range, qualifier, role, fetchImpl, signal,
}) {
  const query = [
    "is:pr",
    `${qualifier}:${author.trim()}`,
    range
      ? `updated:${range.since.slice(0, 10)}..${range.until.slice(0, 10)}`
      : `updated:${date}`,
  ].join(" ");
  const response = await fetchImpl(
    `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100`,
    { headers: headers(token), signal },
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    return {};
  }
  const data = await response.json();
  return formatPullRequestActivity(data.items || [], range, { role });
}

// Reviewing other people's pull requests is real work that leaves no commits, so
// a day spent on review used to look empty. A failed review search degrades to
// the authored results rather than failing the day.
async function fetchPullRequests({ token, date, author, range, fetchImpl, signal }) {
  if (!author?.trim()) return {};
  const shared = { token, date, author, range, fetchImpl, signal };
  const [authored, reviewed] = await Promise.all([
    searchPullRequests({ ...shared, qualifier: "author", role: "author" }),
    searchPullRequests({ ...shared, qualifier: "reviewed-by", role: "reviewer" }),
  ]);
  return mergePullRequestGroups(authored, reviewed);
}

export const githubProvider = { collectActivity: collectGithubActivity };
