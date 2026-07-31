# Local Git Activity Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global GitHub/Local activity source so desktop users can build worklogs from committed work across all local branches.

**Architecture:** Add a shell-free local Git provider with per-repository identities, expose repository selection through a restricted Electron bridge, and select the provider in the shared workflow from persisted settings. Keep Gemini, history, Sheets, scheduling, and recovery shared.

**Tech Stack:** Electron, Next.js, Node.js `execFile`, Git CLI, SQLite, Node test runner.

---

### Task 1: Local Git Core

**Files:**
- Create: `lib/localGitProvider.mjs`
- Test: `test/localGitProvider.test.mjs`
- Test: `test/localGitProvider.integration.test.mjs`

- [ ] Write failing parser, identity, branch-ref, deduplication, authoritative author-date, timeout, output-limit, redaction, and partial-failure tests.
- [ ] Write temporary-repository integration tests for local branches, unpushed commits, dirty-tree exclusion, other-author exclusion, and multiple repository identities.
- [ ] Run `node --test test/localGitProvider*.test.mjs` and confirm failure.
- [ ] Implement inspection, preflight, and collection using shell-free Git execution.
- [ ] Re-run the focused tests and confirm success.

### Task 2: Desktop Repository Bridge

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/lifecycle.cjs`
- Test: `test/electronLifecycle.test.mjs`

- [ ] Write failing tests for folder selection result normalization and bridge methods.
- [ ] Add native directory selection and safe repository inspection IPC handlers.
- [ ] Run the Electron lifecycle tests.

### Task 3: Source-Aware Workflow

**Files:**
- Modify: `lib/worklogService.mjs`
- Modify: `app/api/automation/run/route.js`
- Modify: `app/api/github/activity/route.js`
- Modify: `app/page.jsx`
- Modify: `electron/scheduler.cjs`
- Test: `test/worklogService.test.mjs`
- Test: `test/automationRoutes.test.mjs`
- Test: `test/scheduler.test.mjs`

- [ ] Write failing tests for source-aware validation, provider selection, preflight-before-claim, and warning propagation.
- [ ] Implement the minimal provider-selection and result contracts, including scheduler notifications.
- [ ] Run focused workflow, route, and scheduler tests.

### Task 4: Settings and UI

**Files:**
- Modify: `app/components/SettingsView.jsx`
- Modify: `app/components/DashboardView.jsx`
- Modify: `app/globals.css`
- Modify: `app/page.jsx`
- Test: `test/automationUi.test.mjs`

- [ ] Write failing UI contract tests for source switching and local repository controls.
- [ ] Add the segmented source control, repository picker/list, identity overrides, and active-source dashboard state.
- [ ] Verify desktop and narrow viewport layouts.

### Task 5: Verification and Release

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Document Git requirements and local-mode setup.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Build the unsigned macOS app directory and run `scripts/smoke-packaged-app.cjs`.
- [ ] Commit, merge to `master`, push, tag the patch release, and confirm installer workflows start.
