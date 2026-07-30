import { randomUUID } from "node:crypto";

import {
  checkpointAutomationHistory,
  checkpointAutomationIntent,
  checkpointAutomationPreWrite,
  claimAutomationAttempt,
  cleanupAutomationAttempts,
  interruptStaleAttempts,
  releaseAutomationLease,
  renewAutomationLease,
  transitionAutomationAttempt,
} from "../../../../lib/automationStore.mjs";
import { authorizeAutomationRequest } from "../../../../lib/automationAuth.mjs";
import {
  automationErrorResponse,
  automationResultResponse,
} from "../../../../lib/automationHttp.mjs";
import { geminiProvider } from "../../../../lib/geminiProvider.mjs";
import { githubProvider } from "../../../../lib/githubProvider.mjs";
import { googleSheetsProvider } from "../../../../lib/googleSheetsProvider.mjs";
import {
  getAppDb,
  getSetting,
  saveHistoryEntry,
  setSetting,
} from "../../../../lib/localDb.mjs";
import {
  localDateAt,
  localDayUtcRange,
  localTimezone,
} from "../../../../lib/localDate.mjs";
import {
  AutomationSetupError,
  executeWorklog,
} from "../../../../lib/worklogService.mjs";

function mapInterrupted(row) {
  return {
    id: row.id,
    workDate: row.work_date,
    status: row.status,
    ownerId: row.owner_id,
    intendedRow: row.intended_row_json
      ? JSON.parse(row.intended_row_json)
      : null,
    intendedRowHash: row.intended_row_hash,
    preWriteRowHash: row.pre_write_row_hash,
    historyId: row.history_id,
  };
}

function persistence(db, settings) {
  return {
    saveHistory(entry) {
      const saved = {
        ...entry,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      saveHistoryEntry(db, saved);
      return saved;
    },
    checkpointHistory: (input) => checkpointAutomationHistory(db, input),
    checkpointIntent: (input) => checkpointAutomationIntent(db, input),
    checkpointPreWrite: (input) => checkpointAutomationPreWrite(db, input),
    complete: ({ status, ...input }) =>
      transitionAutomationAttempt(db, { ...input, to: status }),
    cleanup: (input) => cleanupAutomationAttempts(db, input),
    hasHistory: (id) =>
      Boolean(db.prepare("SELECT 1 FROM history WHERE id = ?").get(id)),
    restoreHistory({ attempt, intendedRow }) {
      const entry = {
        id: attempt.historyId,
        developerName: settings.developerName || "",
        workDate: attempt.workDate,
        style: settings.summaryStyle || "concise",
        repos: settings.selectedRepos || [],
        activity: "",
        summary: intendedRow.summary,
        createdAt: new Date().toISOString(),
      };
      saveHistoryEntry(db, entry);
      return entry;
    },
  };
}

function lease(db) {
  return {
    claim: (input) => claimAutomationAttempt(db, input),
    renew: (input) => renewAutomationLease(db, input),
    release: (input) => releaseAutomationLease(db, input),
    interruptStale: (input) => interruptStaleAttempts(db, input),
    listInterrupted: () => db
      .prepare(
        `SELECT * FROM automation_attempts
         WHERE status = 'interrupted' ORDER BY created_at, id`,
      )
      .all()
      .map(mapInterrupted),
  };
}

export async function loadAutomationInput(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AutomationSetupError("Request body must be an object.");
  }
  const timezone = body.timezone || localTimezone();
  const trigger = body.trigger || "manual";
  let workDate;
  try {
    workDate = body.workDate || localDateAt(new Date(), timezone);
  } catch (error) {
    throw new AutomationSetupError(
      error.message || "Invalid work date or timezone.",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new AutomationSetupError("workDate must use YYYY-MM-DD");
  }
  if (!["automatic", "manual"].includes(trigger)) {
    throw new AutomationSetupError("trigger must be automatic or manual");
  }
  try {
    localDayUtcRange(workDate, timezone);
  } catch (error) {
    throw new AutomationSetupError(
      error.message || "Invalid work date or timezone.",
    );
  }
  const db = getAppDb();
  const settings = getSetting(db, "app-settings") || {};
  const providers = {
    github: githubProvider,
    gemini: geminiProvider,
    sheets: {
      ...googleSheetsProvider,
      readRow: (input) => googleSheetsProvider.readRow({
        ...input,
        saveTokens: (tokens) => setSetting(db, "google-tokens", tokens),
      }),
      upsertRow: (input) => googleSheetsProvider.upsertRow({
        ...input,
        saveTokens: (tokens) => setSetting(db, "google-tokens", tokens),
      }),
    },
  };
  return {
    workDate,
    timezone,
    trigger,
    settings,
    tokens: getSetting(db, "google-tokens"),
    providers,
    store: persistence(db, settings),
    lease: lease(db),
    database: db,
  };
}

export function createRunHandler({
  capability = process.env.AUTOMATION_CAPABILITY,
  execute = executeWorklog,
  loadInput = loadAutomationInput,
} = {}) {
  return async function POST(request) {
    const rejection = authorizeAutomationRequest(request, {
      capability,
      mutation: true,
    });
    if (rejection) return rejection;
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return automationErrorResponse(error);
    }
    try {
      return automationResultResponse(await execute(await loadInput(body)));
    } catch (error) {
      return automationErrorResponse(error);
    }
  };
}

export const POST = createRunHandler();
