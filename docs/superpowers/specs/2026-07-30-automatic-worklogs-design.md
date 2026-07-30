# Automatic Worklogs Design

## Goal

Allow an individual developer to configure AI Worklog Agent once and have it automatically create the current day's worklog from GitHub activity, write it to the configured Google Sheet, and report the result without requiring the main window to remain open.

The feature remains local-first. Credentials, schedule settings, execution history, and generated worklogs stay in the user's existing local SQLite database. The app does not introduce a hosted service.

## User Experience

Settings gains an **Automation** section with:

- An `Enable automatic worklogs` toggle.
- A local-time selector, defaulting to 17:30.
- Seven day toggles, with Monday through Friday selected by default.
- A `Start at login` toggle. Enabling automation enables this by default, but the user can turn it off.
- A `Run now` button that executes the same production workflow used by the scheduler.
- Read-only status for the last attempt, last successful write, next scheduled run, and latest error.

The default behavior writes directly to Google Sheets. There is no approval step in the first version.

When the user closes the window, the desktop process remains available in the system tray if automation is enabled. The tray menu contains:

- Open AI Worklog Agent
- Run worklog now
- Automation status
- Quit

The app shows a native desktop notification after an automatic run:

- Success: the worklog was added or the existing date row was updated.
- No activity: no commits or pull requests were found, so nothing was written.
- Failure: a short actionable error and a prompt to open the app.

## Architecture

### Desktop scheduler

Electron owns scheduling because renderer timers stop when the window closes. A focused scheduler module receives the current clock, settings loader, run callback, and notification callback as dependencies so its date and retry behavior can be tested without Electron.

The scheduler checks at a low frequency while the desktop process is running. It evaluates the user's local date, local time, enabled weekdays, and the most recent persisted run. It never depends on a browser window.

Electron uses `app.setLoginItemSettings` to configure start-at-login on macOS and Windows. Enabling automation sets login startup on by default. Disabling automation does not silently change the user's explicit startup preference.

Electron creates a tray icon when automation is enabled or when the user closes the main window while start-at-login is active. Closing the window hides it; choosing Quit exits the server and application explicitly.

The desktop process acquires `app.requestSingleInstanceLock()` before starting the local server or scheduler. A second launch exits after asking the existing instance to show and focus its window. This guarantees one tray, one scheduler, and one server per OS user.

The Electron process generates a cryptographically random capability token for each launch and passes it only to its utility server process. Internal automation endpoints require this token in an authorization header and reject missing or invalid tokens and non-local requests. The server exposes a token-protected identity endpoint so Electron never adopts an unrelated process that happens to be listening on the configured port. Browser-facing routes reject cross-origin mutation requests.

### Server-side workflow

The existing renderer workflow is extracted into a server-side automation service with one responsibility: execute a worklog for a supplied local date.

It:

1. Loads saved credentials and settings from SQLite.
2. Validates GitHub token, author, selected repositories, Gemini key, Google connection, sheet link, and sheet tab.
3. Fetches GitHub activity for the date and configured author.
4. Stops with `no_activity` when there are no commits or pull requests.
5. Generates the selected Gemini summary style.
6. Writes the summary to Google Sheets using the existing date-row upsert behavior.
7. Saves the generated worklog in local history.
8. Persists the automation result.

Manual generation and scheduled generation should share the same domain functions for GitHub collection, summary generation, history storage, and sheet writing. API route handlers remain thin HTTP adapters.

An internal `POST /api/automation/run` route allows the Electron scheduler to invoke the workflow using the per-launch capability token. Settings `Run now` is exposed through a minimal context-isolated preload API and Electron IPC; the main process makes the authenticated server request, so renderer JavaScript and unrelated local processes never receive the capability token. The internal route accepts an optional work date for tests but derives today's local calendar date and timezone by default.

GitHub activity queries use UTC start and end instants derived from that local calendar day in the supplied IANA timezone. The range therefore represents local midnight through the next local midnight, including 23-hour and 25-hour daylight-saving days. The dashboard uses the same local-date helper instead of deriving the displayed date from `toISOString()`.

### Persistence

Automation configuration is stored under a separate `automation-settings` key and updated through a validated automation-specific route:

- `automationEnabled`
- `automationTime` in `HH:mm` local time
- `automationDays` as ISO weekday numbers
- `startAtLogin`

A new `automation_days` table is the durable, unique claim for one local work date. It records the work date, timezone, resolved UTC boundaries, terminal outcome, successful attempt ID, and timestamps. The work date is unique.

A related `automation_attempts` table records:

- A generated run ID
- The claimed automation-day ID
- Trigger (`scheduled`, `catch_up`, or `manual`)
- Status (`running`, `success`, `no_activity`, or `failed`)
- Attempt number and optional parent run ID
- Workflow checkpoint, history entry ID, summary hash, reference hash, and normalized pre-write row hash or explicit row-absent marker
- Sheet action and row number when available
- Error category and sanitized message when applicable
- Started and completed timestamps

The database enforces one `automation_days` claim per work date. A short SQLite transaction creates or claims that day and inserts the next attempt before external calls begin. A separate singleton lease row prevents a manual and automatic execution from running concurrently. Lease acquisition is an atomic compare-and-set of an absent or expired row. The lease lasts five minutes and is renewed every minute only when the stored owner ID matches the runner. Release is also owner-checked. If renewal fails, the runner aborts and must not begin another external side effect. Crashes naturally release the lease through expiry without allowing a normally progressing workflow to overlap.

Manual `Run now` may create a new attempt after another run completes and safely update the existing Google Sheet date row.

A `running` attempt older than 30 minutes is stale. The workflow saves generated history and stores its history ID plus hashes of the exact summary and reference before beginning the Sheet write. It then reads the target date row and transactionally stores either the normalized row hash or an explicit row-absent marker immediately before issuing the write. Startup and resume recovery mark the stale attempt interrupted, then read the date row and compare its normalized values with that checkpoint:

- An exact match proves the write completed; recovery marks the attempt and day successful and restores the stored local history if necessary.
- A missing row or unchanged pre-write row permits the one retry.
- Different content in the same date row is treated as `sheet_conflict`; automation does not overwrite it and asks the user to review it manually.

Because all normal Sheet writes remain date-row upserts, retries cannot append a second date row. Successful and `no_activity` automatic outcomes close the day permanently; an interrupted or failed day is eligible for one automatic retry represented by a second attempt row.

Automation status queries are deterministic:

- Last attempt: attempt with greatest `started_at`.
- Last successful write: attempt with greatest `completed_at` and `status = success`.
- Latest error: attempt with greatest `completed_at` and `status = failed`.
- Next run: calculated from the saved schedule and current local time.

Runs older than 90 days are deleted during routine startup maintenance, while normal worklog history keeps its existing retention behavior.

## Scheduling Rules

- Default schedule: Monday through Friday at the user-selected local time.
- The user's operating-system local timezone is authoritative.
- A due run starts once the configured time is reached.
- If the computer was asleep or the app started late, one catch-up run occurs when the app resumes or starts, but only while it is still the same selected workday.
- A successful run is never repeated automatically for the same date.
- `no_activity` is considered a completed attempt and is not retried automatically that day.
- A failed automatic run retries once after 15 minutes. The persisted retry due time survives restart and sleep. Further retries require `Run now` or the next scheduled day.
- Scheduled and catch-up runs share the same automatic claim and completion rules.
- A manual request made while any run is active returns `already_running`; it does not queue and does not consume the automatic retry allowance.
- Concurrent timer, resume, startup, and manual triggers are protected by an in-memory lock plus the transactional database claim.

## Error Handling

Preflight validation reports missing or expired setup without calling Gemini or Google Sheets. Errors are persisted in `automation_attempts`, shown in Settings, and surfaced through a native notification.

The workflow must distinguish:

- Setup incomplete
- GitHub authentication or rate-limit failure
- No matching activity
- Gemini failure
- Google authentication refresh failure
- Google Sheet access or layout failure
- Local persistence failure

Provider adapters convert raw upstream failures into typed internal errors. Persisted records, API responses, logs, and notifications receive only category-specific sanitized messages; raw provider response bodies are neither returned nor stored. Redaction covers GitHub tokens, Gemini keys, Google client secrets, OAuth tokens, authorization headers, and credential-like URL parameters.

Secrets must not appear in logs, notifications, history records, or error responses. The scheduler does not disable itself after a transient network error.

## Platform Behavior

macOS and Windows use the same scheduler and workflow logic.

- macOS uses the menu bar status item and login-item API.
- Windows uses the notification-area tray and login-item API.
- Native notifications use Electron's `Notification` API.
- The background Next server continues to run as the existing Electron utility process and does not create a second Dock or taskbar application.

Normal interactive launches create and show the window. Login-item launches may start hidden when automation is enabled. Closing the last window while automation is enabled or start-at-login is active cancels the close, hides the window, and keeps the tray, scheduler, and server alive on both platforms. Tray `Open` recreates or reveals the window. Tray `Quit` sets an explicit quitting flag, stops new schedules, waits for or cancels the active request with a bounded timeout, terminates the utility server, destroys the tray, and then exits. If automation and start-at-login are both disabled, closing the final Windows window exits normally; macOS retains its conventional app lifecycle until explicit Quit.

## Testing

Automated coverage includes:

- Due-time and weekday calculations in local time.
- Next-run calculation, IANA timezone boundaries, and daylight-saving transitions.
- Start, resume, and same-day catch-up behavior.
- Transactional duplicate prevention, concurrent startup, and stale-run recovery.
- One retry after failure.
- No retry after success or no activity.
- Workflow preflight validation.
- Full successful workflow with mocked GitHub, Gemini, and Google responses.
- No-activity behavior without Gemini or Sheets calls.
- Automation settings persistence and status serialization.
- Capability-token authorization, preload IPC isolation, server identity verification, origin checks, and credential redaction.
- Tray menu commands, close-to-tray state transitions, explicit Quit, single-instance behavior, and login-item settings through injected Electron adapters.
- Existing manual worklog behavior remains unchanged.

Packaged smoke tests continue on macOS and Windows. They additionally verify login launch without an initial window, second-instance focus behavior, close-to-tray, resume-triggered catch-up, `Run now`, stale-run recovery, and explicit Quit terminating the utility server.

## Scope Boundaries

The first version does not:

- Run while the computer is powered off.
- Use a cloud scheduler or remotely store credentials.
- Infer hours from commit duration.
- Ask for approval before writing.
- Support multiple schedules per day.
- Automatically discover a new monthly Google Sheet link.

Users update the monthly sheet link in Settings, as they do now.
