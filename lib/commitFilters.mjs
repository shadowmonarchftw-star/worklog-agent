export function parseExcludePatterns(...sources) {
  return sources
    .flatMap((source) => String(source ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isExcludedCommit(message, patterns) {
  if (!patterns.length) return false;
  const text = String(message ?? "").toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}
