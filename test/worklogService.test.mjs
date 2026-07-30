import assert from "node:assert/strict";
import test from "node:test";

import {
  executeWorklog,
  recoverInterruptedRuns,
  rowHash,
} from "../lib/worklogService.mjs";
import { ProviderError } from "../lib/providerError.mjs";

const settings = {
  developerName: "Asha",
  githubToken: "github-token",
  githubAuthor: "asha",
  selectedRepos: ["owner/app"],
  geminiApiKey: "gemini-key",
  googleSheetLink: "sheet-id-123",
  googleSheetTab: "Worklog",
  defaultHours: "8",
  summaryStyle: "sheet-cell",
};
const tokens = { access_token: "access", refresh_token: "refresh" };
const intended = {
  date: "7/30/2026",
  summary: "Shipped export fixes.",
  reference: "GitHub",
  hours: "8",
  comments: "",
};

function harness(overrides = {}) {
  const calls = [];
  let owned = true;
  const attempt = { id: "attempt-1", workDate: "2026-07-30" };
  const lease = {
    claim: async () => (calls.push("claim"), { outcome: "claimed", attempt }),
    renew: async () => owned,
    release: async () => calls.push("release"),
  };
  const providers = {
    github: {
      collectActivity: async (input) => {
        calls.push("github");
        assert.deepEqual(
          { since: input.since, until: input.until },
          {
            since: "2026-07-29T18:15:00.000Z",
            until: "2026-07-30T18:15:00.000Z",
          },
        );
        return { activity: "repo: owner/app\n- commit abc fix", commitCount: 1, pullRequestCount: 0 };
      },
    },
    gemini: {
      generateSummary: async () => (calls.push("gemini"), { summary: intended.summary, model: "gemini" }),
    },
    sheets: {
      readRow: async () => (calls.push("read-row"), null),
      upsertRow: async ({ row }) => {
        calls.push("write");
        assert.deepEqual(row, intended);
        return { action: "appended", rowNumber: 9 };
      },
    },
  };
  const store = {
    saveHistory: async () => (calls.push("history"), { id: "history-1" }),
    checkpointHistory: async () => calls.push("checkpoint-history"),
    checkpointIntent: async ({ intendedRow }) => {
      calls.push("checkpoint-intended");
      assert.deepEqual(intendedRow, intended);
    },
    checkpointPreWrite: async ({ preWriteRowHash }) => {
      calls.push("checkpoint-prewrite");
      assert.equal(preWriteRowHash, "row_absent");
    },
    complete: async ({ status }) => calls.push(status === "success" ? "complete" : `complete-${status}`),
  };
  return {
    calls,
    loseLease() { owned = false; },
    args: {
      workDate: "2026-07-30",
      timezone: "Asia/Kathmandu",
      trigger: "automatic",
      ownerId: "owner-1",
      settings,
      tokens,
      providers,
      store,
      lease,
      ...overrides,
    },
  };
}

test("incomplete setup fails before claiming", async () => {
  const h = harness({ settings: { ...settings, geminiApiKey: "" } });
  await assert.rejects(() => executeWorklog(h.args), /Gemini API key/);
  assert.deepEqual(h.calls, []);
});

test("success follows the exact durable side-effect sequence", async () => {
  const h = harness();
  const result = await executeWorklog(h.args);
  assert.equal(result.status, "success");
  assert.deepEqual(h.calls, [
    "claim", "github", "gemini", "history", "checkpoint-history",
    "checkpoint-intended", "read-row", "checkpoint-prewrite", "write",
    "complete", "release",
  ]);
});

test("no activity calls neither Gemini nor Sheets", async () => {
  const h = harness();
  h.args.providers.github.collectActivity = async () => (
    h.calls.push("github"),
    { activity: "none", commitCount: 0, pullRequestCount: 0 }
  );
  const result = await executeWorklog(h.args);
  assert.equal(result.status, "no_activity");
  assert.deepEqual(h.calls, ["claim", "github", "complete-no_activity", "release"]);
});

test("provider failure persists only typed safe error and releases", async () => {
  const h = harness();
  h.args.providers.github.collectActivity = async () => {
    h.calls.push("github");
    throw new ProviderError("github", "GitHub activity is unavailable.", {
      rawBody: "ghp_abcdefghijklmnopqrstuvwxyz123456",
    });
  };
  h.args.store.complete = async (value) => {
    h.calls.push("complete-failed");
    assert.equal(value.errorCategory, "github");
    assert.equal(value.errorMessage, "GitHub activity is unavailable.");
    assert.equal(JSON.stringify(value).includes("ghp_"), false);
  };
  await assert.rejects(() => executeWorklog(h.args), /unavailable/);
  assert.deepEqual(h.calls, ["claim", "github", "complete-failed", "release"]);
});

test("owner loss at a boundary prevents the next external side effect", async () => {
  const h = harness();
  h.args.providers.github.collectActivity = async () => {
    h.calls.push("github");
    h.loseLease();
    return { activity: "activity", commitCount: 1, pullRequestCount: 0 };
  };
  await assert.rejects(() => executeWorklog(h.args), /lease ownership/i);
  assert.deepEqual(h.calls, ["claim", "github", "release"]);
});

test("recovery accepts exact intended row and restores missing history", async () => {
  const calls = [];
  const attempt = {
    id: "attempt-1",
    intendedRow: intended,
    intendedRowHash: rowHash(intended),
    preWriteRowHash: "row_absent",
    historyId: "history-1",
  };
  const result = await recoverInterruptedRuns({
    ownerId: "recovery",
    lease: {
      interruptStale: async () => calls.push("interrupt"),
      listInterrupted: async () => [attempt],
      claimRecovery: async () => (calls.push("claim-recovery"), { outcome: "claimed", attempt }),
      renew: async () => true,
      release: async () => calls.push("release"),
    },
    store: {
      hasHistory: async () => false,
      restoreHistory: async () => calls.push("restore-history"),
      complete: async ({ status }) => calls.push(`complete-${status}`),
      cleanup: async () => calls.push("cleanup"),
    },
    providers: {
      sheets: { readRow: async () => (calls.push("read-row"), intended) },
    },
    settings: { ...settings, defaultHours: "2" },
    tokens,
  });
  assert.equal(result[0].status, "success");
  assert.deepEqual(calls, [
    "interrupt", "claim-recovery", "read-row", "restore-history",
    "complete-success", "release", "cleanup",
  ]);
});

test("recovery marks absent or unchanged prewrite rows for retry", async () => {
  for (const current of [null, { ...intended, summary: "Old value" }]) {
    const completions = [];
    const preWriteRowHash = current ? rowHash(current) : "row_absent";
    const attempt = { id: "a", intendedRow: intended, preWriteRowHash };
    await recoverInterruptedRuns({
      ownerId: "r",
      lease: {
        interruptStale: async () => {},
        listInterrupted: async () => [attempt],
        claimRecovery: async () => ({ outcome: "claimed", attempt }),
        renew: async () => true,
        release: async () => {},
      },
      store: {
        complete: async (value) => completions.push(value),
        cleanup: async () => {},
      },
      providers: { sheets: { readRow: async () => current } },
      settings,
      tokens,
    });
    assert.equal(completions[0].status, "failed");
    assert.equal(completions[0].errorCategory, "retry");
    assert.ok(completions[0].retryDueAt);
  }
});

test("recovery detects a different sheet row as conflict without writing", async () => {
  let writes = 0;
  const completions = [];
  const attempt = { id: "a", intendedRow: intended, preWriteRowHash: "row_absent" };
  await recoverInterruptedRuns({
    ownerId: "r",
    lease: {
      interruptStale: async () => {},
      listInterrupted: async () => [attempt],
      claimRecovery: async () => ({ outcome: "claimed", attempt }),
      renew: async () => true,
      release: async () => {},
    },
    store: {
      complete: async (value) => completions.push(value),
      cleanup: async () => {},
    },
    providers: {
      sheets: {
        readRow: async () => ({ ...intended, summary: "Someone else's value" }),
        upsertRow: async () => writes++,
      },
    },
    settings,
    tokens,
  });
  assert.equal(writes, 0);
  assert.equal(completions[0].errorCategory, "sheet_conflict");
});

test("recovery cleans up exactly once and preserves every reconciliation error", async () => {
  for (const failurePoint of [
    "interrupt", "list", "claim", "read", "restore", "complete", "release",
  ]) {
    const original = new Error(`failure at ${failurePoint}`);
    let cleanupCalls = 0;
    const fail = (point, value) => {
      if (failurePoint === point) throw original;
      return value;
    };
    const attempt = {
      id: "attempt-1",
      workDate: "2026-07-30",
      intendedRow: intended,
      intendedRowHash: rowHash(intended),
      preWriteRowHash: "row_absent",
      historyId: "history-1",
    };

    await assert.rejects(
      () => recoverInterruptedRuns({
        ownerId: "recovery",
        lease: {
          interruptStale: async () => fail("interrupt"),
          listInterrupted: async () => fail("list", [attempt]),
          claimRecovery: async () => fail("claim", { outcome: "claimed", attempt }),
          renew: async () => true,
          release: async () => fail("release"),
        },
        store: {
          hasHistory: async () => false,
          restoreHistory: async () => fail("restore"),
          complete: async () => fail("complete"),
          cleanup: async () => cleanupCalls++,
        },
        providers: {
          sheets: { readRow: async () => fail("read", intended) },
        },
        settings,
        tokens,
      }),
      (error) => error === original,
      failurePoint,
    );
    assert.equal(cleanupCalls, 1, failurePoint);
  }
});
