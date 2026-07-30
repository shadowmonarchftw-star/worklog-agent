import assert from "node:assert/strict";
import test from "node:test";

import { buildSummaryPrompt, cleanSummaryText } from "../lib/summaryPrompt.mjs";

test("buildSummaryPrompt includes user context and asks for grounded work-log output", () => {
  const prompt = buildSummaryPrompt({
    developerName: "Asha",
    workDate: "2026-07-23",
    style: "standup",
    activity: "- fix invoice retry bug\n- merge PR #42 dashboard export",
  });

  assert.match(prompt.system, /daily work-log assistant/i);
  assert.match(prompt.system, /Do not invent/i);
  assert.match(prompt.user, /Asha/);
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
    developerName: "Asha",
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
    developerName: "Asha",
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
