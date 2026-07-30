export function createHistoryEntry({
  workDate,
  style,
  selectedRepos,
  activity,
  summary,
}) {
  return {
    id: `${workDate || "unknown"}-${Date.now()}`,
    developerName: "",
    workDate,
    style,
    repos: selectedRepos || [],
    activity,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export function upsertHistoryEntry(history, entry) {
  return [entry, ...history.filter((item) => item.workDate !== entry.workDate)].slice(0, 20);
}
