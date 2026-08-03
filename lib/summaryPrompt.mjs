export function buildSummaryPrompt({ workDate, style, activity, preference }) {
  const cleanActivity = activity?.trim();

  if (!cleanActivity) {
    throw new Error("Activity is required to generate a work-log summary.");
  }

  const date = workDate?.trim() || "today";
  const summaryStyle = style?.trim() || "concise";
  const styleInstruction = {
    standup:
      "Use standup style: one compact sentence for completed work and one compact sentence for blockers or follow-up if present.",
    concise:
      "Use concise style: 2 to 3 short sentences, no bullets.",
    detailed:
      "Use detailed style: 3 to 5 clear sentences with useful repo/task detail, no Markdown headings.",
    "sheet-cell":
      "Use sheet cell style: one plain worklog sentence ready to paste into a Google Sheet cell.",
    "time-wise":
      "Use time-wise style: group work by actual commit timestamps into Morning, Afternoon, and Evening. Use only the times shown in the activity. If no times are shown, say time-wise grouping is unavailable.",
    "bullet-points":
      "Use short plain-text bullet lines, one line per main task. No Markdown bold.",
  }[summaryStyle] || "Use concise style: 2 to 3 short sentences, no bullets.";

  return {
    system:
      "You are a daily work-log assistant for software developers. Turn GitHub commits, pushes, and PR notes into a clear factual work summary. Do not invent tasks, time spent, tickets, outcomes, or business impact that are not supported by the activity. Write simple plain English.",
    user: `Date: ${date}
Summary style: ${summaryStyle}
Style instruction: ${styleInstruction}
User preference: ${preference?.trim() || "None"}

GitHub activity:
${cleanActivity}

Write one Google Sheet cell-ready daily work summary.

Rules:
- Do not use Markdown.
- No asterisks.
- No headings with symbols.
- Only use bullet markers when Summary style is bullet-points.
- Keep it plain English and easy to paste into one spreadsheet cell.
- Use 2 to 5 short sentences or semicolon-separated clauses.
- Mention repo names naturally when useful.
- Mention uncertainty only if commit messages are vague or incomplete.`,
  };
}

export function cleanSummaryText(summary, { preserveBullets = false } = {}) {
  const cleaned = summary
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "");

  if (preserveBullets) {
    return cleaned.trim();
  }

  return cleaned.replace(/^\s*[-*]\s+/gm, "").trim();
}
