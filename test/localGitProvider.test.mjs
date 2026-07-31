import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesIdentity,
  parseGitLog,
  sanitizeGitError,
} from "../lib/localGitProvider.mjs";

test("parses delimiter-safe git log records", () => {
  const output = [
    "abc", "Asha", "asha@work.test", "2026-07-31T09:15:00+05:45", "fix parser",
    "def", "Asha", "asha@work.test", "2026-07-31T10:15:00+05:45", "ship UI",
    "",
  ].join("\0");
  assert.deepEqual(parseGitLog(output).map(({ sha, subject }) => ({ sha, subject })), [
    { sha: "abc", subject: "fix parser" },
    { sha: "def", subject: "ship UI" },
  ]);
});

test("email identities never fall back to a same-name mismatch", () => {
  const identity = {
    emails: ["asha@work.test"],
    names: ["Asha"],
  };
  assert.equal(matchesIdentity({ email: "asha@work.test", name: "Other" }, identity), true);
  assert.equal(matchesIdentity({ email: "other@test", name: "Asha" }, identity), false);
  assert.equal(matchesIdentity({ email: "", name: "Asha" }, { emails: [], names: ["asha"] }), true);
});

test("sanitized git errors do not expose repository paths", () => {
  const message = sanitizeGitError(
    new Error("fatal: cannot access '/Users/asha/Secret Client/repo'"),
    "/Users/asha/Secret Client/repo",
    "Client repo",
  );
  assert.equal(message.includes("/Users/asha"), false);
  assert.match(message, /Client repo/);
});
