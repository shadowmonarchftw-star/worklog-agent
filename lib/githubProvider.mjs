import {
  buildActivityResult,
  dayRangeUtc,
  filterCommitsByRange,
  formatPullRequestActivity,
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
    const response = await fetchImpl(
      `https://api.github.com/repos/${repo}/commits?${params}`,
      { headers: headers(token), signal },
    );
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new ProviderError("github", `GitHub commits request failed for ${repo}.`);
    }
    const commits = await response.json();
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

async function fetchPullRequests({ token, date, author, range, fetchImpl, signal }) {
  if (!author?.trim()) return {};
  const query = [
    "is:pr",
    `author:${author.trim()}`,
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
  return formatPullRequestActivity(data.items || [], range);
}

export const githubProvider = { collectActivity: collectGithubActivity };
