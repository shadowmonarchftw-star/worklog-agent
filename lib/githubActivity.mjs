export function formatRepositoryActivity({
  repoFullName,
  commits = [],
  pullRequests = [],
  timeZone,
}) {
  const header = `repo: ${repoFullName}`;

  if (!commits.length && !pullRequests.length) {
    return `${header}\n- No commits or PR activity found for this date.`;
  }

  const commitLines = commits.map((item) => {
    const shortSha = item.sha.slice(0, 7);
    const title = item.commit?.message?.split("\n")[0] || "No commit message";
    const time = formatCommitTime(
      item.commit?.author?.date || item.commit?.committer?.date,
      timeZone,
    );
    const author = item.commit?.author?.name ? ` by ${item.commit.author.name}` : "";
    return `- ${time ? `${time} ` : ""}commit ${shortSha} ${title}${author}`;
  });

  const pullRequestLines = pullRequests.map((item) => {
    return `- ${item.stateLabel} #${item.number} ${item.title}`;
  });

  const lines = [...pullRequestLines, ...commitLines];
  return [header, ...lines].join("\n");
}

export function formatPullRequestActivity(items, range, { role = "author" } = {}) {
  return items.filter((item) => isWithinRange(
    item.updated_at || item.pull_request?.merged_at || item.created_at,
    range,
  )).reduce((groups, item) => {
    const repoFullName = item.repository_url?.split("/repos/")[1];
    if (!repoFullName) {
      return groups;
    }

    const stateLabel = role === "reviewer"
      ? "reviewed PR"
      : item.pull_request?.merged_at ? "merged PR" : "PR activity";
    groups[repoFullName] ||= [];
    groups[repoFullName].push({
      number: item.number,
      title: item.title,
      stateLabel,
    });
    return groups;
  }, {});
}

// Reviewing your own PR is possible on GitHub, and a PR you authored can also
// come back from the reviewed search. Authored work is the stronger claim, so it
// wins and the duplicate review line is dropped.
export function mergePullRequestGroups(authored, reviewed) {
  const merged = {};
  for (const [repo, items] of Object.entries(authored || {})) {
    merged[repo] = [...items];
  }
  for (const [repo, items] of Object.entries(reviewed || {})) {
    merged[repo] ||= [];
    const seen = new Set(merged[repo].map((item) => item.number));
    merged[repo].push(...items.filter((item) => !seen.has(item.number)));
  }
  return merged;
}

export function buildActivityResult({
  date,
  repos,
  commitResults,
  prGroups = {},
}) {
  const selectedRepos = new Set(repos);
  const selectedPrGroups = Object.fromEntries(
    Object.entries(prGroups).filter(([repo]) => selectedRepos.has(repo)),
  );
  const activity = commitResults
    .map(({ repo, commits }) =>
      formatRepositoryActivity({
        repoFullName: repo,
        commits,
        pullRequests: selectedPrGroups[repo] || [],
      }),
    )
    .join("\n\n");

  return {
    activity,
    commitCount: commitResults.reduce(
      (total, item) => total + item.commits.length,
      0,
    ),
    pullRequestCount: Object.values(selectedPrGroups).reduce(
      (total, items) => total + items.length,
      0,
    ),
    repoCount: commitResults.length,
    date,
  };
}

export function extractCommitAuthors(commits, { currentUser } = {}) {
  const authors = new Map();

  if (currentUser?.login) {
    authors.set(currentUser.login, {
      value: currentUser.login,
      label: currentUser.login,
    });
  }

  for (const item of commits || []) {
    const value = item.author?.login || item.commit?.author?.name;
    if (value && !authors.has(value)) {
      authors.set(value, {
        value,
        label: value,
      });
    }
  }

  return [...authors.values()];
}

export function formatCommitTime(date, timeZone) {
  if (!date) {
    return "";
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  if (!timeZone) return parsed.toISOString().slice(11, 16);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

export function normalizeToken(token) {
  const cleanToken = token?.trim();

  if (!cleanToken) {
    throw new Error("Missing GitHub token.");
  }

  if (!/^[\x20-\x7E]+$/.test(cleanToken)) {
    throw new Error(
      "GitHub token contains invalid characters. Paste only the plain token from GitHub, with no quotes, spaces, or copied page text.",
    );
  }

  return cleanToken;
}

function isWithinRange(timestamp, range) {
  if (!range?.since || !range?.until) {
    return true;
  }
  const instant = new Date(timestamp).getTime();
  return instant >= new Date(range.since).getTime()
    && instant < new Date(range.until).getTime();
}

export function filterCommitsByRange(commits, range) {
  return commits.filter((item) => isWithinRange(
    item.commit?.author?.date || item.commit?.committer?.date,
    range,
  ));
}

export function dayRangeUtc(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return {
    since: start.toISOString(),
    until: end.toISOString(),
  };
}
