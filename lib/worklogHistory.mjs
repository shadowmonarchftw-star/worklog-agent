export function createHistoryEntry({
  workDate,
  style,
  selectedRepos,
  activity,
  summary,
  commitCount = 0,
  pullRequestCount = 0,
  activitySource = "github",
}) {
  return {
    id: `${workDate || "unknown"}-${Date.now()}`,
    developerName: "",
    workDate,
    style,
    repos: selectedRepos || [],
    activity,
    summary,
    commitCount,
    pullRequestCount,
    activitySource,
    createdAt: new Date().toISOString(),
  };
}

export function upsertHistoryEntry(history, entry) {
  return [entry, ...history.filter((item) => item.workDate !== entry.workDate)].slice(0, 20);
}
