import {
  dayRangeUtc,
  formatPullRequestActivity,
  formatRepositoryActivity,
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
    const { githubToken, repoFullName, repoFullNames, date, author } = await request.json();
    const token = normalizeToken(githubToken);
    const repos = repoFullNames?.length ? repoFullNames : [repoFullName].filter(Boolean);

    if (!repos.length) {
      return Response.json({ error: "Select at least one repository." }, { status: 400 });
    }

    if (!date) {
      return Response.json({ error: "Choose a date." }, { status: 400 });
    }

    const { since, until } = dayRangeUtc(date);
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
          commits: await response.json(),
        };
      }),
    );

    const prGroups = await fetchPullRequests({ token, date, author });

    const activity = commitResults
      .map(({ repo, commits }) =>
        formatRepositoryActivity({
          repoFullName: repo,
          commits,
          pullRequests: prGroups[repo] || [],
        }),
      )
      .join("\n\n");

    return Response.json({
      activity,
      count: commitResults.reduce((total, item) => total + item.commits.length, 0),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}

async function fetchPullRequests({ token, date, author }) {
  if (!author?.trim()) {
    return {};
  }

  const query = [
    "is:pr",
    `author:${author.trim()}`,
    `updated:${date}`,
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
  return formatPullRequestActivity(data.items || []);
}
