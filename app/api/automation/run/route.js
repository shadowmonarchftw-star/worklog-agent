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
import { geminiProvider } from "../../../../lib/geminiProvider.mjs";
import { githubProvider } from "../../../../lib/githubProvider.mjs";
import { googleSheetsProvider } from "../../../../lib/googleSheetsProvider.mjs";
import {
  getAppDb,
  getSetting,
  saveHistoryEntry,
  setSetting,
} from "../../../../lib/localDb.mjs";
import { localDateAt, localTimezone } from "../../../../lib/localDate.mjs";
import { redactProviderSecrets } from "../../../../lib/providerError.mjs";
import { executeWorklog } from "../../../../lib/worklogService.mjs";

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
  const db = getAppDb();
  const timezone = body.timezone || localTimezone();
  const workDate = body.workDate || localDateAt(new Date(), timezone);
  const trigger = body.trigger || "manual";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new TypeError("workDate must use YYYY-MM-DD");
  }
  if (!["automatic", "manual"].includes(trigger)) {
    throw new TypeError("trigger must be automatic or manual");
  }
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
    try {
      const body = await request.json().catch(() => ({}));
      return Response.json({ result: await execute(await loadInput(body)) });
    } catch (error) {
      return Response.json(
        {
          error: redactProviderSecrets(
            error.safeMessage || error.message || "Automation failed.",
          ),
        },
        { status: 400 },
      );
    }
  };
}

export const POST = createRunHandler();
