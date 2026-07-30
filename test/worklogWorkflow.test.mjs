import assert from "node:assert/strict";
import test from "node:test";

import {
  activityInputKey,
  canWriteToGoogle,
  createEmptyActivityState,
  hasWorkActivity,
  isCurrentActivityRequest,
  reconcileRepoSelection,
} from "../lib/worklogWorkflow.mjs";

test("activity request identity rejects stale input results", () => {
  const snapshot = {
    requestId: 2,
    inputKey: activityInputKey({
      workDate: "2026-07-30",
      githubAuthor: "asha",
      githubToken: "token-a",
      selectedRepos: ["owner/app"],
    }),
  };

  assert.equal(isCurrentActivityRequest(snapshot, snapshot), true);
  assert.equal(isCurrentActivityRequest(snapshot, { ...snapshot, requestId: 3 }), false);
  assert.equal(
    isCurrentActivityRequest(snapshot, {
      ...snapshot,
      inputKey: activityInputKey({
        workDate: "2026-07-31",
        githubAuthor: "asha",
        githubToken: "token-a",
        selectedRepos: ["owner/app"],
      }),
    }),
    false,
  );
});

test("activity input changes when GitHub token changes", () => {
  const input = {
    workDate: "2026-07-30",
    githubAuthor: "asha",
    selectedRepos: ["owner/app"],
  };
  assert.notEqual(
    activityInputKey({ ...input, githubToken: "token-a" }),
    activityInputKey({ ...input, githubToken: "token-b" }),
  );
});

test("input reset clears activity workflow state", () => {
  assert.deepEqual(createEmptyActivityState(), {
    activity: "",
    commitCount: 0,
    pullRequestCount: 0,
    summary: "",
    error: "",
    sheetStatus: "",
    showActivity: false,
  });
});

test("no-activity responses stop generation", () => {
  assert.equal(hasWorkActivity({ commitCount: 0, pullRequestCount: 0 }), false);
  assert.equal(hasWorkActivity({ commitCount: 1, pullRequestCount: 0 }), true);
});

test("Google write eligibility requires all connected inputs", () => {
  assert.equal(
    canWriteToGoogle({ googleSheetLink: "https://sheet", googleConnected: true, summary: "Done" }),
    true,
  );
  assert.equal(
    canWriteToGoogle({ googleSheetLink: "https://sheet", googleConnected: false, summary: "Done" }),
    false,
  );
});

test("repository reload keeps only still-accessible selections", () => {
  assert.deepEqual(
    reconcileRepoSelection(["owner/app", "gone/repo"], [
      { fullName: "owner/app" },
      { fullName: "owner/api" },
    ]),
    ["owner/app"],
  );
  assert.deepEqual(reconcileRepoSelection([], [{ fullName: "owner/app" }]), []);
});
