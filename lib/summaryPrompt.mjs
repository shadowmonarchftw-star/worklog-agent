export function buildSummaryPrompt({ developerName, workDate, style, activity }) {
  const cleanActivity = activity?.trim();

  if (!cleanActivity) {
    throw new Error("Activity is required to generate a work-log summary.");
  }

  const name = developerName?.trim() || "Developer";
  const date = workDate?.trim() || "today";
  const summaryStyle = style?.trim() || "concise";

  return {
    system:
      "You are a daily work-log assistant for software developers. Turn GitHub commits, pushes, and PR notes into a clear factual work summary. Do not invent tasks, time spent, tickets, outcomes, or business impact that are not supported by the activity. Write simple plain English.",
    user: `Developer: ${name}
Date: ${date}
Summary style: ${summaryStyle}

GitHub activity:
${cleanActivity}

Write one Google Sheet cell-ready daily work summary.

Rules:
- Do not use Markdown.
- No asterisks.
- No headings with symbols.
- No bullet markers unless needed for readability.
- Keep it plain English and easy to paste into one spreadsheet cell.
- Use 2 to 5 short sentences or semicolon-separated clauses.
- Mention repo names naturally when useful.
- Mention uncertainty only if commit messages are vague or incomplete.`,
  };
}

export function cleanSummaryText(summary) {
  return summary
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}
