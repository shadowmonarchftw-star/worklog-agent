import { createHash, randomUUID } from "node:crypto";

import { formatSheetDate } from "./googleSheets.mjs";
import { localDayUtcRange } from "./localDate.mjs";
import { ProviderError, redactProviderSecrets } from "./providerError.mjs";

const REQUIRED_SETTINGS = [
  ["githubToken", "GitHub token"],
  ["githubAuthor", "GitHub author"],
  ["selectedRepos", "GitHub repositories"],
  ["geminiApiKey", "Gemini API key"],
  ["googleSheetLink", "Google Sheet"],
];

class LeaseOwnershipError extends Error {
  constructor() {
    super("Automation lease ownership was lost.");
  }
}

function validateSetup(settings, tokens) {
  for (const [key, label] of REQUIRED_SETTINGS) {
    const value = settings?.[key];
    if (key === "selectedRepos" ? !Array.isArray(value) || !value.length : !String(value || "").trim()) {
      throw new Error(`${label} is required.`);
    }
  }
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error("Google connection tokens are required.");
  }
}

export function normalizeRow(row) {
  return {
    date: String(row?.date ?? "").replace(/\s+/g, " ").trim(),
    summary: String(row?.summary ?? "").replace(/\s+/g, " ").trim(),
    reference: String(row?.reference ?? "").replace(/\s+/g, " ").trim(),
    hours: String(row?.hours ?? "").replace(/\s+/g, " ").trim(),
    comments: String(row?.comments ?? "").replace(/\s+/g, " ").trim(),
  };
}

export function rowHash(row) {
  return createHash("sha256").update(JSON.stringify(normalizeRow(row))).digest("hex");
}

function startRenewal(lease, ownerId) {
  let ownerLost = false;
  const timer = setInterval(async () => {
    try {
      if (!await lease.renew({ ownerId })) ownerLost = true;
    } catch {
      ownerLost = true;
    }
  }, 60_000);
  timer.unref?.();
  return {
    async assertOwned() {
      if (ownerLost || !await lease.renew({ ownerId })) {
        ownerLost = true;
        throw new LeaseOwnershipError();
      }
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function failureFields(error) {
  if (error instanceof ProviderError) {
    return { errorCategory: error.category, errorMessage: error.safeMessage };
  }
  return {
    errorCategory: "internal",
    errorMessage: redactProviderSecrets(error?.message || "Worklog failed."),
  };
}

export async function executeWorklog({
  workDate,
  timezone,
  trigger,
  ownerId = randomUUID(),
  settings,
  tokens,
  providers,
  store,
  lease,
}) {
  validateSetup(settings, tokens);
  const range = localDayUtcRange(workDate, timezone);
  const claimed = await lease.claim({
    workDate, timezone, trigger, ownerId, ...range,
  });
  if (claimed.outcome !== "claimed") return claimed;

  const attemptId = claimed.attempt.id;
  const renewal = startRenewal(lease, ownerId);
  try {
    await renewal.assertOwned();
    const activity = await providers.github.collectActivity({
      token: settings.githubToken,
      repos: settings.selectedRepos,
      author: settings.githubAuthor,
      date: workDate,
      ...range,
    });
    if (!activity.commitCount && !activity.pullRequestCount) {
      await store.complete({ attemptId, ownerId, status: "no_activity" });
      return { status: "no_activity", attemptId };
    }

    await renewal.assertOwned();
    const generated = await providers.gemini.generateSummary({
      apiKey: settings.geminiApiKey,
      workDate,
      style: settings.summaryStyle,
      activity: activity.activity,
    });
    const history = await store.saveHistory({
      developerName: settings.developerName || "",
      workDate,
      style: settings.summaryStyle || "concise",
      repos: settings.selectedRepos,
      activity: activity.activity,
      summary: generated.summary,
    });
    await store.checkpointHistory({ attemptId, ownerId, historyId: history.id });
    const intendedRow = normalizeRow({
      date: formatSheetDate(workDate),
      summary: generated.summary,
      reference: settings.reference || "GitHub",
      hours: settings.defaultHours || "8",
      comments: "",
    });
    await store.checkpointIntent({ attemptId, ownerId, intendedRow });

    await renewal.assertOwned();
    const currentRow = await providers.sheets.readRow({
      settings, tokens, workDate,
    });
    await store.checkpointPreWrite({
      attemptId,
      ownerId,
      preWriteRowHash: currentRow ? rowHash(currentRow) : "row_absent",
    });

    await renewal.assertOwned();
    const write = await providers.sheets.upsertRow({
      settings, tokens, workDate, row: intendedRow,
    });
    await store.complete({
      attemptId,
      ownerId,
      status: "success",
      historyId: history.id,
      sheetAction: write.action,
      sheetRow: write.rowNumber,
    });
    return { status: "success", attemptId, summary: generated.summary, ...write };
  } catch (error) {
    if (!(error instanceof LeaseOwnershipError)) {
      await store.complete({
        attemptId,
        ownerId,
        status: "failed",
        ...failureFields(error),
      });
    }
    throw error;
  } finally {
    renewal.stop();
    await lease.release({ ownerId });
  }
}

function retryAt(now = new Date()) {
  return new Date(new Date(now).valueOf() + 10 * 60 * 1000).toISOString();
}

export async function recoverInterruptedRuns({
  ownerId,
  settings,
  tokens,
  providers,
  store,
  lease,
  now = new Date(),
}) {
  await lease.interruptStale({ olderThanMinutes: 30, now });
  const attempts = await lease.listInterrupted();
  const results = [];
  for (const candidate of attempts) {
    const claimed = await lease.claimRecovery({
      attemptId: candidate.id, ownerId, now,
    });
    if (claimed.outcome !== "claimed") continue;
    const attempt = claimed.attempt;
    const renewal = startRenewal(lease, ownerId);
    try {
      await renewal.assertOwned();
      const current = await providers.sheets.readRow({
        settings, tokens, workDate: attempt.workDate,
      });
      const currentHash = current ? rowHash(current) : "row_absent";
      if (currentHash === attempt.intendedRowHash) {
        if (attempt.historyId && store.hasHistory && !await store.hasHistory(attempt.historyId)) {
          await store.restoreHistory({ attempt, intendedRow: attempt.intendedRow });
        }
        await store.complete({
          attemptId: attempt.id, ownerId, status: "success",
          historyId: attempt.historyId,
        });
        results.push({ id: attempt.id, status: "success" });
      } else if (currentHash === attempt.preWriteRowHash) {
        await store.complete({
          attemptId: attempt.id, ownerId, status: "failed",
          errorCategory: "retry",
          errorMessage: "Sheet write was not observed; retry is required.",
          retryDueAt: retryAt(now),
        });
        results.push({ id: attempt.id, status: "failed", retry: true });
      } else {
        await store.complete({
          attemptId: attempt.id, ownerId, status: "failed",
          errorCategory: "sheet_conflict",
          errorMessage: "The target sheet row changed after the write checkpoint.",
        });
        results.push({ id: attempt.id, status: "failed", conflict: true });
      }
    } finally {
      renewal.stop();
      await lease.release({ ownerId });
    }
  }
  await store.cleanup({ olderThanDays: 90, now });
  return results;
}
