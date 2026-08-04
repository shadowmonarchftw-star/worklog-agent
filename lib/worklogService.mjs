import { createHash, randomUUID } from "node:crypto";

import { formatSheetDate } from "./googleSheets.mjs";
import { localDayUtcRange } from "./localDate.mjs";
import { ProviderError, redactProviderSecrets } from "./providerError.mjs";

const SHARED_REQUIRED_SETTINGS = [
  ["googleSheetLink", "Google Sheet"],
];

export function summaryProviderName(settings) {
  return (settings?.summaryProvider || "gemini") === "local" ? "local" : "gemini";
}

// The two providers need different credentials, so selection decides both which
// object to call and what to hand it. Keeping that in one place means the
// automatic, recovery, and manual paths cannot drift apart.
function summaryCall(providers, settings) {
  if (summaryProviderName(settings) === "local") {
    return {
      generate: providers.localModel.generateSummary,
      options: {
        baseUrl: settings.localModelBaseUrl,
        model: settings.localModelName,
        apiKey: settings.localModelApiKey,
      },
    };
  }
  return {
    generate: providers.gemini.generateSummary,
    options: { apiKey: settings.geminiApiKey },
  };
}

export class AutomationSetupError extends TypeError {}

class LeaseOwnershipError extends Error {
  constructor() {
    super("Automation lease ownership was lost.");
  }
}

function validateSetup(settings, tokens) {
  const source = settings?.activitySource || "github";
  const sourceRequirements = source === "local"
    ? [["localRepositories", "Local repositories"]]
    : [
      ["githubToken", "GitHub token"],
      ["githubAuthor", "GitHub author"],
      ["selectedRepos", "GitHub repositories"],
    ];
  const summaryRequirements = summaryProviderName(settings) === "local"
    ? [["localModelName", "Local model name"]]
    : [["geminiApiKey", "Gemini API key"]];
  for (const [key, label] of [
    ...sourceRequirements,
    ...summaryRequirements,
    ...SHARED_REQUIRED_SETTINGS,
  ]) {
    const value = settings?.[key];
    if (["selectedRepos", "localRepositories"].includes(key)
      ? !Array.isArray(value) || !value.length
      : !String(value || "").trim()) {
      throw new AutomationSetupError(`${label} is required.`);
    }
  }
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new AutomationSetupError("Google connection tokens are required.");
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
  const normalized = normalizeRow(row);
  return createHash("sha256").update(JSON.stringify({
    date: normalized.date,
    summary: normalized.summary,
    hours: normalized.hours,
  })).digest("hex");
}

function startRenewal(lease, ownerId, { intervalMs = 60_000 } = {}) {
  let ownerLost = false;
  const controller = new AbortController();
  const loseOwnership = () => {
    if (ownerLost) return;
    ownerLost = true;
    controller.abort(new LeaseOwnershipError());
  };
  const timer = setInterval(async () => {
    try {
      if (!await lease.renew({ ownerId })) loseOwnership();
    } catch {
      loseOwnership();
    }
  }, intervalMs);
  return {
    get ownerLost() {
      return ownerLost;
    },
    signal: controller.signal,
    async assertOwned() {
      if (ownerLost || !await lease.renew({ ownerId })) {
        loseOwnership();
        throw controller.signal.reason;
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
  renewalIntervalMs,
  now = () => new Date(),
}) {
  validateSetup(settings, tokens);
  const range = localDayUtcRange(workDate, timezone);
  const activityProvider = providers.activity || providers.github;
  await activityProvider.preflight?.({ settings, signal: undefined });
  const claimed = await lease.claim({
    workDate, timezone, trigger, ownerId, ...range,
  });
  if (claimed.outcome !== "claimed") return claimed;

  const attemptId = claimed.attempt.id;
  const renewal = startRenewal(lease, ownerId, { intervalMs: renewalIntervalMs });
  try {
    await renewal.assertOwned();
    const activity = await activityProvider.collectActivity({
      token: settings.githubToken,
      repos: (settings.activitySource || "github") === "local"
        ? settings.localRepositories
        : settings.selectedRepos,
      author: settings.githubAuthor,
      date: workDate,
      timezone,
      ...range,
      signal: renewal.signal,
    });
    await renewal.assertOwned();
    if (!activity.commitCount && !activity.pullRequestCount) {
      await store.complete({ attemptId, ownerId, status: "no_activity" });
      return {
        status: "no_activity",
        attemptId,
        warnings: activity.warnings || [],
      };
    }

    const summary = summaryCall(providers, settings);
    const style = settings.summaryStyle || "concise";
    const generated = await summary.generate({
      ...summary.options,
      workDate,
      style: settings.summaryStyle,
      activity: activity.activity,
      preference: settings.summaryPreference,
      // Past rewrites only sharpen the wording, so a store that cannot supply
      // them must not be able to fail a scheduled run.
      examples: (await store.summaryExamples?.({ style })) || [],
      signal: renewal.signal,
    });
    await renewal.assertOwned();
    const history = await store.saveHistory({
      developerName: settings.developerName || "",
      workDate,
      style: settings.summaryStyle || "concise",
      repos: (settings.activitySource || "github") === "local"
        ? settings.localRepositories.map((repo) => repo.displayName)
        : settings.selectedRepos,
      activity: activity.activity,
      summary: generated.summary,
    });
    await store.checkpointHistory({ attemptId, ownerId, historyId: history.id });
    const intendedRow = normalizeRow({
      date: formatSheetDate(workDate),
      summary: generated.summary,
      reference: settings.reference ||
        ((settings.activitySource || "github") === "local" ? "Local Git" : "GitHub"),
      hours: settings.defaultHours || "8",
      comments: "",
    });
    await store.checkpointIntent({ attemptId, ownerId, intendedRow });

    await renewal.assertOwned();
    const currentRow = await providers.sheets.readRow({
      settings, tokens, workDate, signal: renewal.signal,
    });
    await store.checkpointPreWrite({
      attemptId,
      ownerId,
      preWriteRowHash: currentRow ? rowHash(currentRow) : "row_absent",
    });

    await renewal.assertOwned();
    const write = await providers.sheets.upsertRow({
      settings, tokens, workDate, row: intendedRow, signal: renewal.signal,
    });
    await store.complete({
      attemptId,
      ownerId,
      status: "success",
      historyId: history.id,
      sheetAction: write.action,
      sheetRow: write.rowNumber,
    });
    return {
      status: "success",
      attemptId,
      summary: generated.summary,
      warnings: activity.warnings || [],
      ...write,
    };
  } catch (error) {
    if (!(error instanceof LeaseOwnershipError) && !renewal.ownerLost) {
      await store.complete({
        attemptId,
        ownerId,
        status: "failed",
        ...(trigger === "automatic"
          ? { retryDueAt: retryAt(currentTime(now)) }
          : {}),
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
  return new Date(new Date(now).valueOf() + 15 * 60 * 1000).toISOString();
}

function currentTime(now) {
  return typeof now === "function" ? now() : now;
}

async function markRecoveryRetry({ store, attempt, ownerId, now, results }) {
  await store.complete({
    attemptId: attempt.id, ownerId, status: "failed",
    errorCategory: "retry",
    errorMessage: "Sheet write was not observed; retry is required.",
    retryDueAt: retryAt(now),
  });
  results.push({
    id: attempt.id,
    status: "failed",
    retry: true,
    errorCategory: "retry",
    errorMessage: "Sheet write was not observed; retry is required.",
  });
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
  let recoveryError;
  const results = [];
  const outcome = { results, maintenanceWarning: null };
  try {
    await lease.interruptStale({ olderThanMinutes: 30, now });
    const attempts = await lease.listInterrupted();
    for (const candidate of attempts) {
      const claimed = await lease.claimRecovery({
        attemptId: candidate.id, ownerId, now,
      });
      if (claimed.outcome !== "claimed") continue;
      const attempt = claimed.attempt;
      const renewal = startRenewal(lease, ownerId);
      try {
        await renewal.assertOwned();
        if (
          !attempt.intendedRow ||
          !attempt.intendedRowHash ||
          !attempt.preWriteRowHash
        ) {
          await markRecoveryRetry({ store, attempt, ownerId, now, results });
          continue;
        }
        const current = await providers.sheets.readRow({
          settings,
          tokens,
          workDate: attempt.workDate,
          signal: renewal.signal,
        });
        const currentHash = current ? rowHash(current) : "row_absent";
        if (currentHash === attempt.intendedRowHash) {
          const historyMissing =
            attempt.historyId &&
            store.hasHistory &&
            !await store.hasHistory(attempt.historyId);
          if (historyMissing) {
            await renewal.assertOwned();
            await store.restoreHistory({ attempt, intendedRow: attempt.intendedRow });
          }
          await store.complete({
            attemptId: attempt.id, ownerId, status: "success",
            historyId: attempt.historyId,
          });
          results.push({ id: attempt.id, status: "success" });
        } else if (currentHash === attempt.preWriteRowHash) {
          // The process may have stopped before observing the response. Since
          // the row is unchanged from the pre-write checkpoint, retry the
          // date-specific upsert safely before reporting a failure.
          if (typeof providers.sheets.upsertRow !== "function") {
            await markRecoveryRetry({ store, attempt, ownerId, now, results });
            continue;
          }
          await renewal.assertOwned();
          await providers.sheets.upsertRow({
            settings,
            tokens,
            workDate: attempt.workDate,
            row: attempt.intendedRow,
            signal: renewal.signal,
          });
          await renewal.assertOwned();
          const verified = await providers.sheets.readRow({
            settings,
            tokens,
            workDate: attempt.workDate,
            signal: renewal.signal,
          });
          if (verified && rowHash(verified) === attempt.intendedRowHash) {
            const historyMissing =
              attempt.historyId &&
              store.hasHistory &&
              !await store.hasHistory(attempt.historyId);
            if (historyMissing) {
              await renewal.assertOwned();
              await store.restoreHistory({ attempt, intendedRow: attempt.intendedRow });
            }
            await store.complete({
              attemptId: attempt.id,
              ownerId,
              status: "success",
              historyId: attempt.historyId,
            });
            results.push({ id: attempt.id, status: "success", recovered: true });
          } else {
            await markRecoveryRetry({ store, attempt, ownerId, now, results });
          }
        } else {
          await store.complete({
            attemptId: attempt.id, ownerId, status: "failed",
            errorCategory: "sheet_conflict",
            errorMessage: "The target sheet row changed after the write checkpoint.",
          });
          results.push({
            id: attempt.id,
            status: "failed",
            conflict: true,
            errorCategory: "sheet_conflict",
            errorMessage: "The target sheet row changed after the write checkpoint.",
          });
        }
      } finally {
        renewal.stop();
        await lease.release({ ownerId });
      }
    }
    return outcome;
  } catch (error) {
    recoveryError = error;
    throw error;
  } finally {
    try {
      await store.cleanup({ olderThanDays: 90, now });
    } catch (cleanupError) {
      if (!recoveryError) {
        const warning = cleanupError instanceof ProviderError
          ? cleanupError
          : new ProviderError(
            "maintenance",
            redactProviderSecrets(
              cleanupError?.message || "Automation cleanup failed.",
            ),
          );
        outcome.maintenanceWarning = {
          category: warning.category,
          safeMessage: warning.safeMessage,
        };
      }
    }
  }
}
