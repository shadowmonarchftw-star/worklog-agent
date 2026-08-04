const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parts(date) {
  if (!DATE_PATTERN.test(date || "")) {
    throw new TypeError("Reference date must use YYYY-MM-DD");
  }
  return date.split("-").map(Number);
}

function toDate(value) {
  return value.toISOString().slice(0, 10);
}

// Work dates are plain calendar dates, so the arithmetic stays in UTC rather
// than converting to an instant in the user's zone. A local-midnight round trip
// is what shifts a Monday onto the previous Sunday near a DST boundary.
export function rollupPeriodRange({ period, reference }) {
  const [year, month, day] = parts(reference);

  if (period === "month") {
    return {
      start: toDate(new Date(Date.UTC(year, month - 1, 1))),
      end: toDate(new Date(Date.UTC(year, month, 0))),
    };
  }

  if (period !== "week") {
    throw new TypeError("period must be week or month");
  }

  const cursor = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay() puts Sunday at 0; a work week reads better starting on Monday.
  const offset = (cursor.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, day - offset));
  const end = new Date(Date.UTC(year, month - 1, day - offset + 6));
  return { start: toDate(start), end: toDate(end) };
}

// A rewrite is what the user actually stood behind, so it wins over the text the
// model produced for that day.
export function selectRollupDays(history, { start, end }) {
  return (history || [])
    .filter((entry) => entry?.workDate >= start && entry?.workDate <= end)
    .map((entry) => ({
      workDate: entry.workDate,
      summary: (entry.editedSummary?.trim() || entry.summary?.trim() || ""),
    }))
    .filter((entry) => entry.summary)
    .sort((a, b) => a.workDate.localeCompare(b.workDate));
}

export function buildRollupPrompt({
  period,
  start,
  end,
  days,
  preference,
}) {
  if (!days?.length) {
    throw new Error("There are no summaries in this period to roll up.");
  }

  const label = period === "month" ? "month" : "week";
  const dayLines = days
    .map((entry) => `${entry.workDate}: ${entry.summary}`)
    .join("\n");

  return {
    system:
      `You are a work-log assistant for software developers. Combine a developer's daily work summaries into one short ${label}ly update for a manager or a standup. Do not invent tasks, time spent, tickets, outcomes, or business impact that the daily summaries do not state. Write simple plain English.`,
    user: `Period: ${label} of ${start} to ${end}
Days with recorded work: ${days.length} day${days.length === 1 ? "" : "s"}
User preference: ${preference?.trim() || "None"}

Daily summaries:
${dayLines}

Write one ${label}ly summary of this work.

Rules:
- Do not use Markdown.
- No asterisks.
- No headings with symbols.
- Group related work together instead of repeating each day in order.
- Say what changed over the ${label}, not what happened on each date.
- Do not list days that have no recorded work, and do not guess at them.
- Keep it to 3 to 6 short sentences.
- Mention repo or project names naturally when useful.
- Reply with the summary text only. No preamble, no closing question, no code fences.`,
  };
}
