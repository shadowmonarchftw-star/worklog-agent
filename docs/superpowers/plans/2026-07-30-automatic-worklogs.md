# Automatic Worklogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local weekday scheduling that starts AI Worklog Agent at login, runs in the tray, generates the configured user's worklog, and writes it automatically to Google Sheets.

**Architecture:** Electron owns single-instance lifecycle, login startup, tray, notifications, and a testable local scheduler. The standalone Next server owns credentials, provider calls, workflow orchestration, and SQLite run state. Electron calls the server with a per-launch capability token; renderer `Run now` uses a context-isolated preload IPC bridge.

**Tech Stack:** Electron 43, Next.js 16 App Router, React 19, SQLite via `better-sqlite3`, Node test runner, GitHub REST API, Gemini API, Google Sheets API

---

## File Structure

New focused modules:

- `lib/localDate.mjs`: local calendar dates, IANA timezone boundaries, schedule calculations.
- `lib/automationStore.mjs`: automation settings, day claims, attempts, leases, status queries, and cleanup.
- `lib/worklogService.mjs`: one server-side worklog execution shared by manual and scheduled entry points.
- `lib/providerError.mjs`: typed sanitized provider errors and credential redaction.
- `lib/automationAuth.mjs`: capability-token and local-request validation.
- `electron/scheduler.cjs`: due checks, catch-up, retry timing, and resume behavior.
- `electron/lifecycle.cjs`: testable tray/window/quit and login-item decisions.
- `electron/preload.cjs`: minimal automation run, settings-save, and status IPC exposure.
- `app/api/automation/settings/route.js`: validated automation configuration and status.
- `app/api/automation/run/route.js`: token-protected scheduler execution.
- `app/api/automation/recover/route.js`: token-protected startup/resume reconciliation.
- `app/components/AutomationSection.jsx`: Automation Settings interface.

Existing modules modified:

- `lib/localDb.mjs`: schema initialization for automation tables.
- `lib/githubActivity.mjs`: accept explicit UTC activity boundaries.
- `app/api/github/activity/route.js`: delegate through shared worklog provider code.
- `app/api/generate-summary/route.js`: delegate through shared Gemini provider code.
- `app/api/google/write-summary/route.js`: delegate through shared Sheets provider code.
- `app/page.jsx`: load/save automation state and use a local date.
- `app/components/SettingsView.jsx`: add Automation navigation.
- `app/globals.css`: compact automation controls and statuses.
- `electron/app-server.cjs`: pass capability token and verify server identity.
- `electron/main.cjs`: compose scheduler, IPC, tray, notifications, single-instance behavior, and shutdown.
- `package.json`: package preload/tray assets and bump the release version at completion.

### Task 1: Local Calendar and Schedule Math

**Files:**
- Create: `lib/localDate.mjs`
- Create: `test/localDate.test.mjs`
- Modify: `lib/githubActivity.mjs`
- Modify: `test/githubActivity.test.mjs`
- Modify: `app/page.jsx`

- [ ] **Step 1: Write failing local-time tests**

Cover local `YYYY-MM-DD`, ISO weekdays, next selected run, Kathmandu boundaries, and a DST transition:

```js
test("converts a New York spring DST day to exact UTC boundaries", () => {
  assert.deepEqual(
    localDayUtcRange("2026-03-08", "America/New_York"),
    {
      since: "2026-03-08T05:00:00.000Z",
      until: "2026-03-09T04:00:00.000Z",
    },
  );
});
```

Add boundary assertions for pull requests as well as commits: an event at the first instant is included, one at `until` is excluded, and selected-repository filtering still applies. Cover `Asia/Kathmandu` and a DST timezone.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test test/localDate.test.mjs test/githubActivity.test.mjs`

Expected: FAIL because `lib/localDate.mjs` and explicit range support do not exist.

- [ ] **Step 3: Implement local date helpers**

Export:

```js
export function localDateAt(now = new Date()) {}
export function localTimezone() {}
export function isoWeekday(date, timezone) {}
export function localDayUtcRange(date, timezone) {}
export function nextScheduledAt({ now, time, days, timezone }) {}
```

Use `Intl.DateTimeFormat` and offset calculations, never `toISOString().slice(0, 10)` for the user's calendar date. Keep all returned persisted dates ASCII ISO strings.

- [ ] **Step 4: Make GitHub collection accept `{ since, until }`**

Keep the current public behavior as a compatibility default, but allow the automation workflow to pass local-day-derived UTC boundaries. Fetch pull requests with a broad GitHub Search date window, then filter their timestamps against the exact supplied UTC instants locally; do not rely on Search's date-only timezone semantics.

- [ ] **Step 5: Replace the dashboard's UTC-derived initial date**

Initialize `workDate` with `localDateAt()` so manual and automatic worklogs select the same date.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test test/localDate.test.mjs test/githubActivity.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/localDate.mjs lib/githubActivity.mjs app/page.jsx test/localDate.test.mjs test/githubActivity.test.mjs
git commit -m "Add local workday schedule calculations"
```

### Task 2: Durable Automation State and Lease

**Files:**
- Create: `lib/automationStore.mjs`
- Create: `test/automationStore.test.mjs`
- Modify: `lib/localDb.mjs`
- Modify: `test/localDb.test.mjs`

- [ ] **Step 1: Write failing schema and store tests**

Test:

- Defaults are `{ enabled: false, time: "17:30", days: [1,2,3,4,5], startAtLogin: false, startAtLoginConfigured: false }`.
- Settings updates validate `HH:mm` and weekday values.
- Two concurrent claim attempts produce one owner.
- Lease renew/release require the owner ID.
- An expired lease can be acquired.
- Automatic attempts are limited to initial plus one retry.
- Manual attempts are rejected while a lease is active.
- Stale running attempts become `interrupted`.
- Status queries return deterministic last/next/error fields.
- Cleanup removes automation records older than 90 days.

Use two database handles against the same temporary SQLite file for the concurrency assertion:

```js
const results = await Promise.allSettled([
  claimAutomationRun(dbA, input),
  claimAutomationRun(dbB, input),
]);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(getActiveAttempts(dbA).length, 1);
```

Assert the full transition matrix: normal execution permits `running -> success | no_activity | failed`; stale recovery permits `running -> interrupted -> success | failed`; all other terminal transitions are rejected; automatic attempt three is rejected; and manual claims return `already_running` while a lease is held.

Test startup preference semantics:

```text
first automation enable + not configured -> startAtLogin true, configured true
explicit opt-out -> startAtLogin false, configured true
disable and re-enable -> preserve false
restart -> preserve saved choice
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/automationStore.test.mjs test/localDb.test.mjs`

Expected: FAIL because the automation schema/store is absent.

- [ ] **Step 3: Add SQLite schema**

Create `automation_days`, `automation_attempts`, and singleton `automation_lease` tables with foreign keys and indexes. Use `db.transaction()` for claims:

```js
const claim = db.transaction((input) => {
  // Insert/find day, atomically acquire unexpired lease, insert attempt.
  return { day, attempt, leaseOwner };
});
```

Store only sanitized errors. Keep automation settings under `automation-settings`, separate from `app-settings`.

- [ ] **Step 4: Implement owner-checked lease operations**

Use a five-minute expiry and one-minute renewal cadence. `renewLease` and `releaseLease` include `WHERE owner_id = ?`; callers treat `changes !== 1` as lease loss.

- [ ] **Step 5: Implement attempt checkpoints and status queries**

Support transitions:

```text
running -> success
running -> no_activity
running -> failed
running -> interrupted
```

Persist history ID, immutable normalized intended row JSON and hash (date, summary, reference, hours, comments), pre-write row hash or `row_absent`, retry due time, sheet action, and row number. Recovery must use this payload if current settings later change.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test test/automationStore.test.mjs test/localDb.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/automationStore.mjs lib/localDb.mjs test/automationStore.test.mjs test/localDb.test.mjs
git commit -m "Persist automatic worklog runs safely"
```

### Task 3: Shared Server-Side Worklog Service

**Files:**
- Create: `lib/providerError.mjs`
- Create: `lib/githubProvider.mjs`
- Create: `lib/geminiProvider.mjs`
- Create: `lib/googleSheetsProvider.mjs`
- Create: `lib/worklogService.mjs`
- Create: `test/providerError.test.mjs`
- Create: `test/worklogService.test.mjs`
- Modify: `app/api/github/activity/route.js`
- Modify: `app/api/generate-summary/route.js`
- Modify: `app/api/google/write-summary/route.js`

- [ ] **Step 1: Write failing service tests with injected providers**

Test setup validation, success, no activity, provider failure, lease loss, history-before-write checkpointing, exact Sheet recovery, row absence, changed settings during recovery, and sheet conflict:

```js
const result = await executeWorklog(
  { workDate: "2026-07-30", timezone: "Asia/Kathmandu", trigger: "scheduled" },
  { settings, collectActivity, generateSummary, writeSheet, store, lease },
);
assert.equal(result.status, "success");
```

Assert no Gemini or Sheets call on no activity. Assert no external call starts after lease renewal reports ownership loss.

Use ordered spies to prove the successful sequence:

```js
assert.deepEqual(calls, [
  "claim", "github", "gemini", "history", "checkpoint-intended-row",
  "read-sheet-row", "checkpoint-pre-write-row", "write-sheet-row",
  "complete-success", "release",
]);
```

For recovery, change current hours after checkpointing and assert comparison still uses the original immutable intended row. Different existing content must return `sheet_conflict` without calling `writeSheet`.

- [ ] **Step 2: Write failing redaction tests**

Feed raw errors containing GitHub, Gemini, OAuth, and URL credentials. Assert public errors contain a typed category and no secret substrings.

- [ ] **Step 3: Verify tests fail**

Run: `node --test test/providerError.test.mjs test/worklogService.test.mjs`

Expected: FAIL because the service and provider adapters do not exist.

- [ ] **Step 4: Extract provider adapters**

Move network behavior from route handlers into functions that accept credentials and structured input. Throw `ProviderError(category, safeMessage)` without preserving raw bodies in serializable fields.

- [ ] **Step 5: Implement `executeWorklog`**

Order side effects:

1. Validate settings and active Google tokens.
2. Claim day/attempt/lease.
3. Collect local-day GitHub activity.
4. Complete `no_activity`, or generate summary.
5. Save history and checkpoint exact hashes.
6. Read and checkpoint the existing Sheet row.
7. Write/upsert the row.
8. Complete success and release the lease.

Use `try/finally` for owner-checked release and a renewal timer with an abort signal.

- [ ] **Step 6: Make existing API routes thin adapters**

Manual dashboard routes call the extracted providers. Preserve their current response contracts so existing UI behavior does not regress.

- [ ] **Step 7: Implement startup and resume recovery**

Export `recoverInterruptedRuns({ now, store, readSheetRow })`. It atomically moves stale `running` attempts to `interrupted`, compares the current row with persisted intended and pre-write snapshots, then moves `interrupted` to `success` for exact intended-row matches or `failed` with retry/conflict metadata for other outcomes. It schedules one retry for absent/unchanged rows, marks different rows `sheet_conflict` without writing, and removes terminal automation records older than 90 days.

The server exposes this service only through the authenticated recovery route added in Task 4. Electron never imports server-side `lib` files. Add assertions for all three reconciliation outcomes and ensure cleanup is called once per startup.

- [ ] **Step 8: Run focused and full tests**

Run: `node --test test/providerError.test.mjs test/worklogService.test.mjs test/githubActivityRoute.test.mjs test/googleSheets.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/providerError.mjs lib/githubProvider.mjs lib/geminiProvider.mjs lib/googleSheetsProvider.mjs lib/worklogService.mjs app/api test
git commit -m "Share the automatic worklog workflow"
```

### Task 4: Authenticated Automation APIs

**Files:**
- Create: `lib/automationAuth.mjs`
- Create: `app/api/automation/run/route.js`
- Create: `app/api/automation/recover/route.js`
- Create: `app/api/automation/settings/route.js`
- Create: `app/api/automation/identity/route.js`
- Create: `test/automationAuth.test.mjs`
- Create: `test/automationRoutes.test.mjs`
- Modify: `electron/app-server.cjs`
- Modify: `test/appServer.test.mjs`

- [ ] **Step 1: Write failing authorization tests**

Require:

```http
Authorization: Bearer <WORKLOG_AGENT_CAPABILITY>
```

Reject missing/wrong tokens, non-loopback hosts, and cross-origin mutations. Identity returns a launch nonce only when authorized.

Assert concrete 401/403/success results for missing token, wrong token, non-loopback host, hostile `Origin`, and valid loopback authorization. Assert every rejected request leaves the worklog service spy untouched.

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/automationAuth.test.mjs test/automationRoutes.test.mjs test/appServer.test.mjs`

- [ ] **Step 3: Implement token-safe request guards**

Compare token buffers with `crypto.timingSafeEqual`. Never return the capability token. Keep renderer-accessible Settings GET/POST limited to validated configuration and sanitized status.

- [ ] **Step 4: Pass launch credentials to the utility server**

Generate token and identity nonce in Electron. Add both to the environment for packaged utility-server and Electron-managed `npm run dev` modes. Replace readiness adoption with authenticated identity verification.

`ELECTRON_START_URL` remains a UI-only development mode. It explicitly disables scheduler startup, automation IPC, and tray `Run now` because Electron cannot prove or configure an externally managed server. Test that external mode reports `automationAvailable: false` and never sends launch credentials to the external URL.

- [ ] **Step 5: Implement automation routes**

`POST /api/automation/run` calls `executeWorklog`; `POST /api/automation/recover` calls `recoverInterruptedRuns`; `GET/POST /api/automation/settings` reads validated configuration/status; identity proves the expected server owns the port. Run and recovery routes both require the capability token and loopback request.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test test/automationAuth.test.mjs test/automationRoutes.test.mjs test/appServer.test.mjs && npm test`

- [ ] **Step 7: Commit**

```bash
git add lib/automationAuth.mjs app/api/automation electron/app-server.cjs test
git commit -m "Secure local automation controls"
```

### Task 5: Electron Scheduler

**Files:**
- Create: `electron/scheduler.cjs`
- Create: `test/scheduler.test.mjs`
- Modify: `electron/main.cjs`

- [ ] **Step 1: Write failing scheduler tests**

Use a fake clock and injected API client. Cover due weekday, disabled day, same-day catch-up, persisted retry after 15 minutes, no retry after terminal outcomes, resume, timer/manual collision, and next-run status.

Assert an exact due-time edge:

```js
await scheduler.tick(new Date("2026-07-30T17:29:59+05:45"));
assert.equal(run.calls.length, 0);
await scheduler.tick(new Date("2026-07-30T17:30:00+05:45"));
assert.equal(run.calls.length, 1);
await scheduler.tick(new Date("2026-07-30T17:31:00+05:45"));
assert.equal(run.calls.length, 1);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/scheduler.test.mjs`

- [ ] **Step 3: Implement scheduler**

Expose:

```js
function createScheduler({ clock, loadSettings, loadStatus, recover, run, notify }) {
  return { start, stop, tick, resume, runNow };
}
```

Use one minute checks. Depend on persisted claims for correctness; the timer is only a wake-up mechanism.

- [ ] **Step 4: Compose scheduler in Electron**

After authenticated server readiness, call the token-protected recovery endpoint and await it before starting the scheduler. On `powerMonitor` resume, await the same endpoint before evaluating catch-up. If recovery fails, do not start a concurrent run; record/notify the sanitized failure and retry reconciliation on the next tick. Map normal run results to native notification titles and concise sanitized bodies.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/scheduler.test.mjs && npm test`

- [ ] **Step 6: Commit**

```bash
git add electron/scheduler.cjs electron/main.cjs test/scheduler.test.mjs
git commit -m "Schedule automatic weekday worklogs"
```

### Task 6: Single Instance, Tray, Login Startup, and IPC

**Files:**
- Create: `electron/lifecycle.cjs`
- Create: `electron/preload.cjs`
- Create: `test/electronLifecycle.test.mjs`
- Modify: `electron/main.cjs`
- Modify: `package.json`
- Modify: `test/packageConfig.test.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

Cover single-instance rejection/focus, normal launch, hidden login launch, Windows close-to-tray, macOS activation, tray Open/Run/Quit, settings reconciliation, start-at-login updates, and bounded explicit shutdown.

Assert this state matrix with injected Electron fakes:

```text
automation on + close -> hide, process alive
automation off + Windows close -> quit
login launch + automation on -> no initial window, tray alive
second instance -> existing window shown/focused, second exits
Quit -> scheduler stopped before server; forced exit only after 10 seconds
settings changed -> scheduler, tray, and login item reconciled once
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/electronLifecycle.test.mjs test/packageConfig.test.mjs`

- [ ] **Step 3: Implement lifecycle state machine**

Acquire the single-instance lock before server startup. Track `isQuitting`. Intercept close only when background behavior is enabled. Recreate destroyed windows from tray or macOS activation.

- [ ] **Step 4: Add tray and login item**

Use the existing branded icon. Tray menu status is disabled text, followed by Open, Run worklog now, and Quit. Apply `app.setLoginItemSettings` when validated automation settings change.

- [ ] **Step 5: Add context-isolated preload IPC**

Expose only:

```js
contextBridge.exposeInMainWorld("worklogDesktop", {
  runAutomation: () => ipcRenderer.invoke("automation:run"),
  saveAutomationSettings: (settings) =>
    ipcRenderer.invoke("automation:save-settings", settings),
  getAutomationStatus: () => ipcRenderer.invoke("automation:status"),
});
```

The IPC handlers validate settings and invoke authenticated internal routes in main; no secret reaches the renderer. After a save, one `reconcileAutomationSettings()` reloads the scheduler, creates/destroys the tray as needed, and applies `app.setLoginItemSettings`. Test all three effects occur immediately without restart.

- [ ] **Step 6: Make shutdown deterministic**

Stop scheduler first, prevent new work, wait up to ten seconds for active work, stop utility server, destroy tray, and exit. Add fallback termination without leaving a background process.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/electronLifecycle.test.mjs test/packageConfig.test.mjs && npm test`

- [ ] **Step 8: Commit**

```bash
git add electron/lifecycle.cjs electron/preload.cjs electron/main.cjs package.json test
git commit -m "Run automation from the system tray"
```

### Task 7: Automation Settings UI

**Files:**
- Create: `app/components/AutomationSection.jsx`
- Create: `test/automationUi.test.mjs`
- Modify: `app/components/SettingsView.jsx`
- Modify: `app/page.jsx`
- Modify: `app/globals.css`
- Modify: `test/uiContract.test.mjs`

- [ ] **Step 1: Write failing UI contract tests**

Require the Automation section, enable and startup toggles, time input, seven day buttons, `Run now`, last/next/error status, and no credential values rendered in status.

- [ ] **Step 2: Verify tests fail**

Run: `node --test test/automationUi.test.mjs test/uiContract.test.mjs`

- [ ] **Step 3: Build the compact Automation section**

Use Lucide `Clock3`, `Play`, and `Power` icons. Use switches for booleans, an `<input type="time">`, compact weekday toggle buttons, and a clear status list. Keep card radius and typography consistent with the redesigned Settings UI.

- [ ] **Step 4: Load and save automation settings separately**

Do not merge them into `app-settings`. Disable enablement until GitHub, Gemini, selected author/repos, Google connection, and Sheet link are complete. Explain the first missing requirement inline.

- [ ] **Step 5: Wire `Run now`**

Use `window.worklogDesktop.runAutomation()` in Electron and refresh status/history after completion. Plain browser development disables the button with `Desktop app required to test automation`; it never adds an unauthenticated HTTP fallback. `npm run desktop` is the supported automation development path.

- [ ] **Step 6: Verify responsive dark/light UI**

Run the app and use Playwright screenshots at 1440x900 and 390x844. Check no overlap, all text contrast, keyboard focus, and weekday/time controls in both themes.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/automationUi.test.mjs test/uiContract.test.mjs && npm test && npm run build`

- [ ] **Step 8: Commit**

```bash
git add app/components/AutomationSection.jsx app/components/SettingsView.jsx app/page.jsx app/globals.css test
git commit -m "Add automatic worklog settings"
```

### Task 8: Packaged Verification and Release

**Files:**
- Create: `electron/smoke-harness.cjs`
- Modify: `scripts/smoke-packaged-app.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/lifecycle.cjs`
- Modify: `.github/workflows/macos-installer.yml`
- Modify: `.github/workflows/windows-installer.yml`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/packageConfig.test.mjs`

- [ ] **Step 1: Extend packaged smoke tests without provider bypasses**

Use a temporary data directory. Verify hidden login launch, authenticated IPC reachability, second-instance behavior, close-to-tray survival, resume-triggered catch-up, stale-run recovery, and explicit Quit terminating the utility server. `Run now` must return the sanitized `setup_incomplete` result from the real production path.

For deterministic lifecycle coverage, the script seeds SQLite with an expired lease and stale `running` attempt containing a row-absent checkpoint. It creates `.automation-smoke-sentinel` in the temporary `WORKLOG_AGENT_DATA_DIR`, then launches the primary executable with `--automation-smoke-harness`.

`electron/smoke-harness.cjs` activates only when all three conditions hold: the exact CLI flag is present, the data directory differs from the platform default, and the sentinel exists. It polls `smoke-command.json` and writes sanitized append-only results to `smoke-events.jsonl`; neither file contains the capability token. Supported commands call the same main-process functions used by production:

```json
{"id":"1","command":"run-now"}
{"id":"2","command":"close-window"}
{"id":"3","command":"resume"}
{"id":"4","command":"open-window"}
{"id":"5","command":"quit"}
```

The smoke script waits for a `ready` event, sends `run-now`, and asserts `setup_incomplete`; sends `close-window` and asserts `window-hidden` plus a still-live PID; launches a second executable and asserts the primary logs `second-instance-focused`; sends `resume` and asserts ordered `recovery-complete` then `catch-up-evaluated`; inspects SQLite to confirm the stale attempt and retry state; finally sends `quit`, asserts `scheduler-stopped`, `server-stopped`, and process exit. Sequence numbers in each event make ordering testable.

Do not ship fake-provider flags or modules. Successful provider orchestration remains covered by injected Task 3 tests. Extend `test/packageConfig.test.mjs` to assert packaged Electron/server sources contain no provider bypass credential or fake-provider module, and add focused harness tests proving commands are inert unless all three activation conditions are satisfied.

- [ ] **Step 2: Update CI workflows**

Run lifecycle smoke checks for Windows x64 and macOS x64/arm64 before creating installers.

- [ ] **Step 3: Document automation setup**

Add concise README steps:

1. Complete GitHub, Gemini, and Google Sheets settings.
2. Open Settings > Automation.
3. Choose days and time.
4. Enable automation.
5. Use Run now once to verify.

Document that the computer must be on and the user logged in.

- [ ] **Step 4: Bump the release version**

Run: `npm version 0.2.0 --no-git-tag-version`

Update installer filenames and release examples in README.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm test
npm run build
npm run dist:dir -- --mac --arm64
node scripts/smoke-packaged-app.cjs "release/mac-arm64/AI Worklog Agent.app/Contents/MacOS/AI Worklog Agent"
```

Expected: all tests and builds PASS; smoke test exits 0; no second `exec` Dock item appears.

- [ ] **Step 6: Inspect final changes**

Run:

```bash
git diff --check
git status --short
git log --oneline master..HEAD
```

Expected: no whitespace errors; only intended files; task commits are present.

- [ ] **Step 7: Commit release preparation**

```bash
git add README.md package.json package-lock.json scripts electron/smoke-harness.cjs electron/main.cjs electron/lifecycle.cjs .github test
git commit -m "Prepare automatic worklogs release"
```

- [ ] **Step 8: Request code review**

Use `superpowers:requesting-code-review`, address findings, rerun all verification, then use `superpowers:finishing-a-development-branch` to merge or push the completed feature.
