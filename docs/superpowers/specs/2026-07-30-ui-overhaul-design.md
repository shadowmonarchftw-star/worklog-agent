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

1. A compact product title bar.
2. A left sidebar with icon-and-text Dashboard and Settings navigation.
3. Real GitHub and Google connection indicators near the bottom.
4. A dark/light segmented theme control.
5. A main page header and independently scrollable content area.

The existing Electron BrowserWindow continues to render this single React app.
No operating-system-specific UI implementation is introduced.

### Dashboard

The Dashboard replaces the existing worklog view and includes:

- Real monitored-repository count.
- Real commit and pull-request counts from fetched activity.
- Real saved-summary count.
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
zero or a clear unavailable state. A first-time user sees a clean empty
dashboard and is directed to Settings only when required setup is incomplete.

### Settings

Settings uses a section navigator and focused configuration panels:

- Credentials: GitHub fine-grained token and Gemini API key.
- GitHub: commit-author selector, repository loading, and repository selection.
- Google Sheets: sheet link, tab, default hours, OAuth client credentials,
  Google connection status, and connect action.
- Output: summary style.
- Appearance: dark and light theme control.

The `Developer` text field, label, and profile copy are removed. GitHub commit
author remains because shared repositories require filtering by the current
developer's GitHub identity. Existing `developerName` values may remain in old
SQLite records for backward compatibility, but the revised UI does not collect
or display them and new summary requests do not rely on the field.

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

Dashboard metrics should be derived from structured activity data when
possible. If the current activity endpoint only supplies formatted text, its
response should be extended compatibly with optional counts while retaining
the existing `activity` field.

The Generate action may fetch activity and generate the summary in one flow.
Inspect Activity fetches and reveals the underlying activity without invoking
Gemini.

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
- Desktop and narrow viewport screenshots.
- Dark and light theme screenshots.
- Browser checks for overflow, overlap, and failed assets.
- Packaged Electron smoke test on macOS.
- Windows packaging configuration and shared-renderer verification; the GitHub
  Actions Windows artifact remains the final native Windows build.

