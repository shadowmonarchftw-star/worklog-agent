import {
  buildActivityResult,
  dayRangeUtc,
  filterCommitsByRange,
  formatPullRequestActivity,
  normalizeToken,
} from "../../../../lib/githubActivity.mjs";

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function POST(request) {
  try {
    const {
      githubToken,
      repoFullName,
      repoFullNames,
      date,
      author,
      since: suppliedSince,
      until: suppliedUntil,
    } = await request.json();
    const token = normalizeToken(githubToken);
    const repos = repoFullNames?.length ? repoFullNames : [repoFullName].filter(Boolean);

    if (!repos.length) {
      return Response.json({ error: "Select at least one repository." }, { status: 400 });
    }

    if (!date) {
      return Response.json({ error: "Choose a date." }, { status: 400 });
    }

    const hasExplicitRange = Boolean(suppliedSince && suppliedUntil);
    const range = hasExplicitRange
      ? { since: suppliedSince, until: suppliedUntil }
      : dayRangeUtc(date);
    const { since, until } = range;
    const params = new URLSearchParams({
      since,
      until,
      per_page: "100",
    });

    if (author?.trim()) {
      params.set("author", author.trim());
    }

    const commitResults = await Promise.all(
      repos.map(async (repo) => {
        const response = await fetch(
          `https://api.github.com/repos/${repo}/commits?${params.toString()}`,
          {
            headers: githubHeaders(token),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`GitHub commits request failed for ${repo}: ${errorText}`);
        }

        return {
          repo,
          commits: hasExplicitRange
            ? filterCommitsByRange(await response.json(), range)
            : await response.json(),
        };
      }),
    );

    const prGroups = await fetchPullRequests({
      token,
      date,
      author,
      range: hasExplicitRange ? range : undefined,
    });

    return Response.json(
      buildActivityResult({
        date,
        repos,
        commitResults,
        prGroups,
      }),
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}

async function fetchPullRequests({ token, date, author, range }) {
  if (!author?.trim()) {
    return {};
  }

  const query = [
    "is:pr",
    `author:${author.trim()}`,
    range
      ? `updated:${range.since.slice(0, 10)}..${range.until.slice(0, 10)}`
      : `updated:${date}`,
  ].join(" ");

  const response = await fetch(
    `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100`,
    {
        headers: githubHeaders(token),
      },
  );

  if (!response.ok) {
    return {};
  }

  const data = await response.json();
  return formatPullRequestActivity(data.items || [], range);
}
