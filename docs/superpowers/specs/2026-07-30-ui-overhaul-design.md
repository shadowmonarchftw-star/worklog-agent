# AI Worklog Agent UI Overhaul Design

## Goal

Replace the current interface with a functional React port of the supplied
`Worklog Agent.dc.html` design. The same interface must run inside Electron on
macOS and Windows without changing the existing GitHub, Gemini, SQLite, Google
OAuth, Google Sheets, history, packaging, or theme behavior.

## Visual Direction

The supplied HTML is the visual source of truth:

- JetBrains Mono throughout.
- Dark theme by default, with a complete light theme.
- Full-height application shell with a narrow title bar, persistent sidebar,
  and scrollable content surface.
- Restrained green accent, neutral panels, subtle borders, compact typography,
  and controls with no more than 10px corner radius.
- Clear active navigation, connection states, loading states, empty states,
  errors, and successful Google Sheet writes.
- Responsive behavior that preserves access to navigation and actions on
  narrower Windows and macOS windows.

The React implementation may make small spacing and responsive adjustments
where the static reference cannot represent real content or window sizes.

## Information Architecture

### App Shell

The shell contains:

1. A compact product bar inside the renderer.
2. A left sidebar with icon-and-text Dashboard and Settings navigation.
3. Real GitHub and Google connection indicators near the bottom.
4. A dark/light segmented theme control.
5. A main page header and independently scrollable content area.

The existing Electron BrowserWindow continues to render this single React app.
No operating-system-specific UI implementation is introduced. Electron keeps
its native frame and native macOS/Windows window controls. The three decorative
window controls in the HTML reference are not reproduced inside the renderer,
because duplicating nonfunctional controls beneath native controls would be
misleading.

### Dashboard

The Dashboard replaces the existing worklog view and includes:

- Real monitored-repository count.
- Real commit and pull-request counts for the selected work date and selected
  repositories.
- Saved-summary count equal to the currently loaded local history entries.
- Work date selector.
- Repository scope indicator.
- Primary `Generate Worklog` action.
- Secondary `Inspect Activity` action.
- Generated summary panel with summary-style badge, copy action, and Google
  Sheet write status.
- Today's activity metrics derived from the fetched GitHub response where the
  API provides them.
- Saved summary history with restore and delete actions.

Stats must never display invented sample values. Before data exists they show
zero. Activity counts represent the latest successful fetch for the current
date, author, and repository selection. They reset to zero, and inspected
activity is cleared, whenever any of those inputs changes. A first-time user
sees a clean empty dashboard and is directed to Settings only when required
setup is incomplete.

`Monitored repositories` always means the current selected-repository count,
independent of whether those repositories contain activity.

### Settings

Settings uses a section navigator and focused configuration panels:

- Credentials: GitHub fine-grained token and Gemini API key.
- GitHub: commit-author selector, repository loading, and repository selection.
- Google Sheets: sheet link, tab, default hours, OAuth client credentials,
  Google connection status, and connect action.
- Output: summary style.
- Appearance: dark and light theme control.

The `Developer` text field, label, profile copy, React state, and settings
payload are removed. GitHub commit author remains because shared repositories
require filtering by the current developer's GitHub identity. New summary
requests omit `developerName`; summary prompting must remain correct when no
developer name is supplied. New history entries use an empty string for the
legacy SQLite `developer_name NOT NULL` column. Existing values remain readable
for backward compatibility but are never displayed.

Settings remain editable after initial setup. Changes continue to persist in
the local SQLite database.

## Data and Behavior

Existing API routes remain the integration boundary. The UI continues to:

1. Load settings and history on startup.
2. Load GitHub authors and repositories from the user's token.
3. Fetch activity for the selected repositories, date, and GitHub author.
4. Generate a Gemini summary using the selected output style.
5. Store or replace the local history entry for that date.
6. Write the generated summary to Google Sheets when configured and connected.

The activity endpoint retains `activity` and returns this exact additional
shape:

```json
{
  "activity": "formatted plain text",
  "commitCount": 7,
  "pullRequestCount": 2,
  "repoCount": 1,
  "date": "2026-07-30"
}
```

Commit and pull-request counts include only selected repositories. GitHub PR
search results must be filtered to the selected repository set before activity
formatting and counting. `repoCount` is the number of selected repositories
successfully queried by that response. Because repository failures fail the
whole request, it equals the selected-repository count on every successful
response; the Dashboard monitored-repository panel reads current selection
state rather than this response field.

The Generate action may fetch activity and generate the summary in one flow.
Inspect Activity fetches and reveals the underlying activity without invoking
Gemini.

Loading repositories preserves the intersection of saved selections and the
repositories returned by GitHub. It does not replace a valid selection with the
first repository. Saved repositories that are no longer accessible are removed
from the selection. When there is no prior valid selection, no repository is
selected automatically.

### Workflow State

- `Inspect Activity` always fetches fresh activity for the current inputs and
  reveals it.
- `Generate Worklog` always fetches fresh activity, then generates from that
  exact response; it does not summarize stale or manually edited activity.
- If the API returns no commits or PRs, the activity panel shows the grounded
  no-activity response and generation stops before calling Gemini.
- A repository-specific GitHub failure fails the complete fetch and preserves
  the previous saved summary, while displaying the error.
- Changing date, author, token, or repositories clears fetched activity,
  activity metrics, current error, Google write status, and the current
  unsaved summary display.
- Repeated generation for a date replaces that date's local history entry and
  updates the same Google Sheet row.
- Buttons are disabled during their relevant request. No request cancellation
  UI is added. Inspect and Generate are mutually disabled while either workflow
  is running.
- Every activity/generation workflow captures a request identity plus its date,
  author, and repository input snapshot. A response is discarded if a newer
  request started or those inputs changed before it completed, preventing stale
  asynchronous results from repopulating cleared state.

### Google Sheets

- A successful generation automatically writes when a sheet is configured and
  Google is connected.
- The existing date-row behavior remains: update the matching date or append a
  row when the date is absent.
- A configured but disconnected sheet does not block local generation; it
  reports that Google must be connected.
- A failed sheet write preserves the generated summary and history entry,
  displays a retryable error status, and permits regeneration or reconnection.
- Ordinary settings saves must not delete or replace stored Google OAuth
  tokens.

## Components

The large page should be divided into focused components where useful:

- `AppShell`
- `Sidebar`
- `PageHeader`
- `DashboardView`
- `DashboardStats`
- `WorklogControls`
- `SummaryPanel`
- `ActivityPanel`
- `HistoryPanel`
- `SettingsView`
- `SettingsSectionNav`
- focused settings sections
- shared icon button, status indicator, and field components

Component extraction should improve readability without introducing a new UI
framework. Icons should come from Lucide React rather than custom CSS drawings.

## Reference Fidelity Checklist

The port must include these supplied-reference elements:

- Product bar with mark, product name, and `LOCAL` badge.
- Persistent sidebar, active green rail, Dashboard and Settings navigation.
- Connection-status block and sidebar theme control.
- Dashboard page header and GitHub-author badge.
- Four metric panels, worklog action panel, summary panel, selected-date
  activity panel, and history panel.
- Settings section navigation and separate Credentials, GitHub, Google Sheets,
  Output, and Appearance panels.
- Reference color roles, typography hierarchy, compact field dimensions,
  loading animation, empty states, success badge, and restrained panel radius.

Reference mock values and decorative fake window buttons are explicitly
excluded. Screenshot comparison is required at 1440x900 and 960x720 in dark
theme, plus 1440x900 in light theme. A narrow 768x900 browser viewport verifies
responsive fallback even though the Electron window enforces a wider minimum.

## Error and Empty States

- Setup-incomplete state points to Settings without rendering credential
  inputs on the Dashboard.
- API failures appear as a compact, readable error notice near the affected
  workflow.
- Empty summary, activity, repository, author, and history states use concise
  plain language and never sample data.
- Loading controls retain stable dimensions and show progress without shifting
  the layout.
- Secret values remain password inputs and are never shown in status copy,
  errors, history, or generated summaries.

## Cross-Platform Requirements

- All UI code remains in the shared Next.js renderer and must behave identically
  in macOS and Windows Electron packages.
- Layout must fit the current minimum window size of 960 by 720 and scale to
  common laptop and large-desktop sizes.
- Controls must not depend on macOS-only hover, fonts, passkeys, window chrome,
  or keyboard behavior.
- Native date and select controls must remain legible in both themes on Chromium
  for Windows and macOS.
- Long repository names, status text, summaries, and errors must wrap or
  truncate without overlap.

## Testing

Automated tests should cover:

- Developer field is absent from the revised UI and summary request behavior.
- Dashboard metrics are calculated from real GitHub activity data.
- Empty and setup-incomplete states contain no sample activity.
- Navigation, theme persistence, summary generation, history restore/delete,
  and settings persistence retain their behavior.
- GitHub author and repository settings remain functional.

Verification should include:

- Full test suite and production build.
- Screenshot comparison at every viewport named in the fidelity checklist.
- Browser checks for overflow, overlap, and failed assets.
- Packaged Electron smoke test on macOS.
- A Windows GitHub Actions smoke step that launches the unpacked packaged app,
  waits for the local server, verifies `/` and `/api/google/status`, and then
  terminates the app. External GitHub, Gemini, and Google operations are covered
  through API/unit tests because CI must not receive user credentials.
