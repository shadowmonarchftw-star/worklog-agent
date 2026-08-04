import assert from "node:assert/strict";
import test from "node:test";

import { buildSummaryPrompt, cleanSummaryText } from "../lib/summaryPrompt.mjs";

test("buildSummaryPrompt includes work context and asks for grounded work-log output", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-07-23",
    style: "standup",
    activity: "- fix invoice retry bug\n- merge PR #42 dashboard export",
  });

  assert.match(prompt.system, /daily work-log assistant/i);
  assert.match(prompt.system, /Do not invent/i);
  assert.doesNotMatch(prompt.user, /Developer:/);
  assert.match(prompt.user, /2026-07-23/);
  assert.match(prompt.user, /standup/);
  assert.match(prompt.user, /fix invoice retry bug/);
  assert.match(prompt.user, /merge PR #42/);
  assert.match(prompt.user, /uncertainty/i);
});

test("buildSummaryPrompt trims empty optional fields and rejects missing activity", () => {
  assert.throws(
    () =>
      buildSummaryPrompt({
        developerName: " ",
        workDate: " ",
        style: "concise",
        activity: " ",
      }),
    /activity is required/i,
  );
});

test("buildSummaryPrompt keeps API credentials out of prompt text", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-07-23",
    style: "concise",
    activity: "commit abc123 add login form",
    geminiApiKey: "secret-key",
  });

  assert.doesNotMatch(prompt.system, /secret-key/);
  assert.doesNotMatch(prompt.user, /secret-key/);
});

test("buildSummaryPrompt asks for Google Sheets-ready plain text", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-07-23",
    style: "concise",
    activity: "commit abc123 add login form",
  });

  assert.match(prompt.user, /Google Sheet cell/i);
  assert.match(prompt.user, /Do not use Markdown/i);
  assert.match(prompt.user, /No asterisks/i);
});

test("cleanSummaryText removes common markdown decorations", () => {
  assert.equal(
    cleanSummaryText("**Overview**\n- Fixed portfolio totals\n## Follow-up"),
    "Overview\nFixed portfolio totals\nFollow-up",
  );
});

test("cleanSummaryText can preserve bullet markers for bullet style", () => {
  assert.equal(
    cleanSummaryText("**Done**\n- Fixed portfolio totals", { preserveBullets: true }),
    "Done\n- Fixed portfolio totals",
  );
});

test("buildSummaryPrompt supports bullet point summary style", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-07-23",
    style: "bullet-points",
    activity: "commit abc123 add login form",
  });

  assert.match(prompt.user, /Use short plain-text bullet lines/i);
  assert.match(prompt.user, /No Markdown bold/i);
});

test("buildSummaryPrompt supports time-wise summary style", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-07-23",
    style: "time-wise",
    activity: "commit abc123 add login form",
  });

  assert.match(prompt.user, /Morning, Afternoon, and Evening/i);
  assert.match(prompt.user, /actual commit timestamps/i);
});

test("buildSummaryPrompt ignores legacy developer names", () => {
  const prompt = buildSummaryPrompt({
    developerName: "Asha",
    workDate: "2026-07-23",
    style: "concise",
    activity: "commit abc123 add login form",
  });

  assert.doesNotMatch(prompt.user, /Asha|Developer:/);
});

test("strips a chat preamble that smaller models add before the summary", () => {
  assert.equal(
    cleanSummaryText("Okay, here's a daily work log:\nShipped the scheduler fix."),
    "Shipped the scheduler fix.",
  );
  assert.equal(
    cleanSummaryText("Sure! Here is the summary:\n\nFixed the update feed."),
    "Fixed the update feed.",
  );
});

test("unwraps a fenced code block around the summary", () => {
  assert.equal(
    cleanSummaryText("```cell\nShipped the scheduler fix.\n```"),
    "Shipped the scheduler fix.",
  );
  assert.equal(
    cleanSummaryText("Here is the summary:\n```\nShipped the fix.\n```"),
    "Shipped the fix.",
  );
});

test("drops a trailing offer to revise the summary", () => {
  assert.equal(
    cleanSummaryText("Shipped the scheduler fix.\n\nWould you like me to revise it further?"),
    "Shipped the scheduler fix.",
  );
  assert.equal(
    cleanSummaryText("Shipped the fix.\nLet me know if you want more detail!"),
    "Shipped the fix.",
  );
});

test("leaves a well-formed summary untouched", () => {
  const good = "Fixed the scheduler guard so a scheduled run is no longer skipped; "
    + "corrected the update metadata that made downloads fail.";
  assert.equal(cleanSummaryText(good), good);
});

test("does not mistake a real sentence for a preamble", () => {
  const starts = "Here the automation writes only columns A, B and D.";
  assert.equal(cleanSummaryText(starts), starts);
  const question = "Reviewed whether the retry budget should count no_activity attempts?";
  assert.equal(cleanSummaryText(question), question);
});

test("preserves bullets while still removing a preamble", () => {
  assert.equal(
    cleanSummaryText("Okay, here's the list:\n- Fixed the guard\n- Updated docs", { preserveBullets: true }),
    "- Fixed the guard\n- Updated docs",
  );
});

test("a curly apostrophe in the preamble is still recognised", () => {
  assert.equal(
    cleanSummaryText("Okay, here’s the standup summary:\nShipped the fix."),
    "Shipped the fix.",
  );
});

test("buildSummaryPrompt teaches voice from summaries the user rewrote", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-08-04",
    style: "concise",
    activity: "commit abc123 add login form",
    examples: [
      "Shipped the login form and cleaned up the retry path.",
      "Fixed invoice totals; started the export job.",
    ],
  });

  assert.match(prompt.user, /rewrote/i);
  assert.match(prompt.user, /Shipped the login form/);
  assert.match(prompt.user, /Fixed invoice totals/);
  // The examples are voice guidance, never source material for the summary.
  assert.match(prompt.user, /Do not copy their content/i);
});

test("buildSummaryPrompt omits the example section when there are no examples", () => {
  const withoutExamples = buildSummaryPrompt({
    workDate: "2026-08-04",
    style: "concise",
    activity: "commit abc123 add login form",
  });
  const withBlankExamples = buildSummaryPrompt({
    workDate: "2026-08-04",
    style: "concise",
    activity: "commit abc123 add login form",
    examples: ["", "   ", null],
  });

  assert.doesNotMatch(withoutExamples.user, /rewrote/i);
  assert.doesNotMatch(withBlankExamples.user, /rewrote/i);
});

test("buildSummaryPrompt bounds example count and length so small local models stay on task", () => {
  const prompt = buildSummaryPrompt({
    workDate: "2026-08-04",
    style: "concise",
    activity: "commit abc123 add login form",
    examples: ["one", "two", "three", "four", "five", "x".repeat(900)],
  });

  assert.match(prompt.user, /one/);
  assert.match(prompt.user, /three/);
  assert.doesNotMatch(prompt.user, /\bfour\b/);
  assert.doesNotMatch(prompt.user, /"x".repeat/);
  assert.equal(prompt.user.includes("x".repeat(500)), false);
});
