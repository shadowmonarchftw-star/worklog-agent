export function activityInputKey({
  workDate,
  githubAuthor,
  githubToken,
  selectedRepos,
  activitySource = "github",
  localRepositories = [],
}) {
  return JSON.stringify({
    workDate,
    activitySource,
    githubAuthor,
    githubToken: githubToken || "",
    selectedRepos: [...(selectedRepos || [])].sort(),
    localRepositories: localRepositories.map((repo) => ({
      path: repo.path,
      acceptedEmails: repo.acceptedEmails || [],
      acceptedNames: repo.acceptedNames || [],
    })),
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
