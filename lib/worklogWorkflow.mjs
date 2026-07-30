export function activityInputKey({
  workDate,
  githubAuthor,
  githubToken,
  selectedRepos,
}) {
  return JSON.stringify({
    workDate,
    githubAuthor,
    githubToken: githubToken || "",
    selectedRepos: [...(selectedRepos || [])].sort(),
  });
}

export function isCurrentActivityRequest(started, current) {
  return (
    started.requestId === current.requestId &&
    started.inputKey === current.inputKey
  );
}

export function createEmptyActivityState() {
  return {
    activity: "",
    commitCount: 0,
    pullRequestCount: 0,
    summary: "",
    error: "",
    sheetStatus: "",
    showActivity: false,
  };
}

export function hasWorkActivity({ commitCount = 0, pullRequestCount = 0 }) {
  return commitCount + pullRequestCount > 0;
}

export function canWriteToGoogle({
  googleSheetLink,
  googleConnected,
  summary,
}) {
  return Boolean(googleSheetLink && googleConnected && summary);
}

export function reconcileRepoSelection(selectedRepos, repos) {
  const available = new Set(repos.map((repo) => repo.fullName));
  return (selectedRepos || []).filter((repo) => available.has(repo));
}
