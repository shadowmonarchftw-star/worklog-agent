export function formatRepositoryActivity({ repoFullName, commits = [], pullRequests = [] }) {
  const header = `repo: ${repoFullName}`;

  if (!commits.length && !pullRequests.length) {
    return `${header}\n- No commits or PR activity found for this date.`;
  }

  const commitLines = commits.map((item) => {
    const shortSha = item.sha.slice(0, 7);
    const title = item.commit?.message?.split("\n")[0] || "No commit message";
    const time = formatCommitTime(item.commit?.author?.date || item.commit?.committer?.date);
    const author = item.commit?.author?.name ? ` by ${item.commit.author.name}` : "";
    return `- ${time ? `${time} ` : ""}commit ${shortSha} ${title}${author}`;
  });

  const pullRequestLines = pullRequests.map((item) => {
    return `- ${item.stateLabel} #${item.number} ${item.title}`;
  });

  const lines = [...pullRequestLines, ...commitLines];
  return [header, ...lines].join("\n");
}

export function formatPullRequestActivity(items) {
  return items.reduce((groups, item) => {
    const repoFullName = item.repository_url?.split("/repos/")[1];
    if (!repoFullName) {
      return groups;
    }

    const stateLabel = item.pull_request?.merged_at ? "merged PR" : "PR activity";
    groups[repoFullName] ||= [];
    groups[repoFullName].push({
      number: item.number,
      title: item.title,
      stateLabel,
    });
    return groups;
  }, {});
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

export function formatCommitTime(date) {
  if (!date) {
    return "";
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(11, 16);
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

export function dayRangeUtc(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return {
    since: start.toISOString(),
    until: end.toISOString(),
  };
}
