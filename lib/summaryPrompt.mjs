// Past summaries the user rewrote are the strongest available signal for their
// voice, but they are also the easiest way to blow the context of a small local
// model and to tempt any model into reusing yesterday's content. Both risks are
// bounded here rather than at the call sites.
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LENGTH = 400;

function formatExamples(examples) {
  const usable = (examples || [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_EXAMPLES)
    .map((item) =>
      item.length > MAX_EXAMPLE_LENGTH
        ? `${item.slice(0, MAX_EXAMPLE_LENGTH).trimEnd()}...`
        : item);

  if (!usable.length) return "";

  return `\nSummaries this user rewrote by hand. Match their wording, length, and level of detail. Do not copy their content — only their voice:
${usable.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n`;
}

export function buildSummaryPrompt({
  workDate,
  style,
  activity,
  preference,
  examples,
}) {
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
${formatExamples(examples)}
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
- Mention uncertainty only if commit messages are vague or incomplete.
- Reply with the summary text only. No preamble, no closing question, no code fences.`,
  };
}

// Smaller local models wrap an answer in conversation even when told not to.
// Gemini rarely does, so this went unnoticed until a 1B model produced
// "Okay, here's a daily work log:" followed by a fenced block and an offer to
// revise. The patterns are deliberately narrow: a preamble must be a whole
// short line that both opens with a filler word and ends in a colon, so a real
// sentence beginning with "Here" survives.
const PREAMBLE = /^(?:ok(?:ay)?|sure|certainly|of course|alright)?[,!]?\s*(?:here(?:['\u2019]s| is| are)|below is|this is)[^\n:]{0,80}:\s*$/i;
const TRAILING_OFFER = /^(?:would you like|let me know|i can (?:also|revise)|shall i|do you want)\b.*$/i;

function stripConversation(text) {
  const lines = text.trim().split("\n");
  while (lines.length > 1 && PREAMBLE.test(lines[0].trim())) lines.shift();
  while (lines.length > 1 && !lines[0].trim()) lines.shift();
  while (lines.length > 1 && TRAILING_OFFER.test(lines[lines.length - 1].trim())) lines.pop();
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();

  const joined = lines.join("\n").trim();
  // A single fenced block is the summary; the fence is formatting, not content.
  const fenced = joined.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return fenced ? fenced[1].trim() : joined;
}

export function cleanSummaryText(summary, { preserveBullets = false } = {}) {
  const cleaned = stripConversation(String(summary))
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "");

  if (preserveBullets) {
    return cleaned.trim();
  }

  return cleaned.replace(/^\s*[-*]\s+/gm, "").trim();
}
