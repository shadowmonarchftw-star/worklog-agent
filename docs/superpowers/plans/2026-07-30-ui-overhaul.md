# AI Worklog Agent UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current interface with a faithful, functional React port of the supplied Worklog Agent design for both macOS and Windows, while removing the Developer field and preserving all integrations.

**Architecture:** Keep the existing Next.js client page as the workflow controller, extract presentation into focused shared React components, and extend the GitHub activity API with structured metrics. The shared renderer remains platform-neutral inside Electron; GitHub Actions performs a native Windows packaged smoke test.

**Tech Stack:** Next.js, React, Electron, Lucide React, CSS, Node test runner, Playwright, electron-builder, GitHub Actions

---

### Task 1: Structured GitHub Activity Metrics

**Files:**
- Modify: `lib/githubActivity.mjs`
- Modify: `app/api/github/activity/route.js`
- Modify: `test/githubActivity.test.mjs`
- Create: `test/githubActivityRoute.test.mjs`

- [ ] Add failing pure tests proving selected-repository PR filtering, metric totals, and grounded no-activity formatting.
- [ ] Add failing route tests for exact `activity`, `commitCount`, `pullRequestCount`, `repoCount`, and `date` fields, selected-repository-only totals, and complete request failure.
- [ ] Run `node --test test/githubActivity.test.mjs test/githubActivityRoute.test.mjs` and confirm the new tests fail.
- [ ] Add a pure activity-result builder returning `activity`, `commitCount`, `pullRequestCount`, `repoCount`, and `date`.
- [ ] Filter PR groups to the selected repository set before formatting or counting.
- [ ] Update the route to return the structured result while retaining `activity`.
- [ ] Run the focused test and `npm test`.
- [ ] Commit the API slice.

### Task 2: Remove Developer State and Preserve Repository Selection

**Files:**
- Create: `lib/worklogWorkflow.mjs`
- Modify: `lib/worklogHistory.mjs`
- Modify: `lib/summaryPrompt.mjs`
- Create: `test/worklogWorkflow.test.mjs`
- Modify: `test/worklogHistory.test.mjs`
- Modify: `test/summaryPrompt.test.mjs`
- Create: `test/uiContract.test.mjs`
- Modify: `app/page.jsx`
- Modify: `README.md`

- [ ] Add failing tests showing new history entries use an empty legacy developer name and prompts contain no Developer fallback or label.
- [ ] Add failing UI/request contract tests requiring the Developer label, state, settings key, and summary payload to be absent.
- [ ] Add failing workflow-state tests for fresh Inspect/Generate fetches, no-activity Gemini prevention, input-change clearing, stale-response rejection, mutual action disabling, GitHub failure preserving the saved summary, date-history replacement, and Google write eligibility.
- [ ] Run `node --test test/worklogHistory.test.mjs test/summaryPrompt.test.mjs test/uiContract.test.mjs test/worklogWorkflow.test.mjs` and confirm failure.
- [ ] Make history entry creation default `developerName` to an empty string.
- [ ] Remove developer handling and fallback text from summary prompting.
- [ ] Add pure workflow helpers for request snapshots, stale-result checks, reset state, action availability, no-activity detection, and Google write eligibility.
- [ ] Remove Developer state, settings persistence, summary payload, restore behavior, and visible field from the page.
- [ ] Change repository loading to retain valid saved selections and select nothing when none remain.
- [ ] Add request identity/input-snapshot protection and reset stale activity metrics when inputs change.
- [ ] Remove Developer setup documentation from README.
- [ ] Run focused tests and the full suite.
- [ ] Commit the state cleanup slice.

### Task 3: Shared Component Structure and Icons

**Files:**
- Create: `app/components/icons.jsx`
- Create: `app/components/AppShell.jsx`
- Create: `app/components/DashboardView.jsx`
- Create: `app/components/SettingsView.jsx`
- Modify: `app/page.jsx`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Install `lucide-react`.
- [ ] Extend the source-contract test with required Dashboard/Settings landmarks and confirm those new assertions fail.
- [ ] Build the product bar, sidebar, navigation, connection states, and theme control.
- [ ] Build the Dashboard with real metrics, controls, summary, activity, sheet status, and history.
- [ ] Build sectioned Settings for credentials, GitHub, Google Sheets, output, and appearance.
- [ ] Keep all existing handlers wired through explicit component props.
- [ ] Run tests and the production build.
- [ ] Commit the component slice.

### Task 4: Reference-Faithful Responsive Styling

**Files:**
- Replace: `app/globals.css`
- Modify: `app/layout.jsx`

- [ ] Add a static CSS contract test for required theme tokens, responsive breakpoints, stable control dimensions, and overflow handling.
- [ ] Run the test and confirm it fails.
- [ ] Implement the reference dark and light palettes, JetBrains Mono typography, restrained green accent, compact controls, panels, status badges, and loading states.
- [ ] Implement layouts for 1440x900, 960x720, and 768x900 without overlap.
- [ ] Ensure native date/select controls, long repository names, errors, and summaries remain readable on Chromium for macOS and Windows.
- [ ] Run tests and production build.
- [ ] Commit the styling slice.

### Task 5: Functional Browser Verification

**Files:**
- Modify as needed after verification: `app/page.jsx`, `app/components/*.jsx`, `app/globals.css`

- [ ] Confirm the canonical local visual reference exists at `/Users/success/Downloads/Worklog Agent UI Redesign/Worklog Agent.dc.html`; stop visual work if it is unavailable.
- [ ] Start `npm run dev` on an available localhost port.
- [ ] Use Playwright to verify first-run Dashboard and Settings have no sample activity and no Developer field.
- [ ] Capture dark screenshots at 1440x900 and 960x720, a narrow screenshot at 768x900, and a light screenshot at 1440x900.
- [ ] Compare hierarchy and layout with `Worklog Agent.dc.html`.
- [ ] Check every screenshot for overlap, clipped text, unstable controls, or blank regions.
- [ ] Exercise navigation, theme switching, Settings sections, and empty-state actions.
- [ ] Fix defects and repeat screenshots until clean.
- [ ] Commit visual verification fixes.

### Task 6: Windows and macOS Packaging Verification

**Files:**
- Modify: `.github/workflows/windows-installer.yml`
- Modify: `.github/workflows/macos-installer.yml`
- Modify: `test/packageConfig.test.mjs`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add failing workflow/config tests requiring unpacked Windows and macOS builds plus explicit launch, wait, HTTP/static-asset checks, and cleanup.
- [ ] Update Windows Actions to build the unpacked app, launch it, verify `/`, `/api/google/status`, and referenced JS/CSS assets, stop it, then build/upload NSIS.
- [ ] Update both macOS matrix jobs to smoke-test the unpacked packaged app with the same page, API, asset, and cleanup checks before creating/uploading the DMG.
- [ ] Bump the release version and update README installer references.
- [ ] Run `npm test`, `npm run build`, and `git diff --check`.
- [ ] Build the macOS package locally and verify `/`, `/api/google/status`, JS, and CSS responses.
- [ ] Confirm the optimized package size remains reasonable.
- [ ] Commit packaging changes.
- [ ] Push `master` and a new version tag to start macOS and Windows installer workflows.
