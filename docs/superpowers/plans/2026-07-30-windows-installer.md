# Windows Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a self-contained Windows installer that colleagues can download and run without installing Node.js or Git.

**Architecture:** Keep `npm run desktop` as the development path. In packaged builds, Electron starts the compiled Next.js production server from the installed application, then opens its local URL. Electron Builder packages the app and rebuilds `better-sqlite3` for Electron on a Windows GitHub Actions runner.

**Tech Stack:** Electron, Next.js, Electron Builder, NSIS, GitHub Actions, Node.js test runner

---

### Task 1: Packaged Server Runtime

**Files:**
- Create: `electron/app-server.cjs`
- Modify: `electron/main.cjs`
- Test: `test/appServer.test.mjs`

- [x] Write a failing test for development and packaged server configuration.
- [x] Run the test and confirm the missing runtime module causes failure.
- [x] Implement a focused server module that starts Next development externally and production internally.
- [x] Update Electron startup and shutdown to use the server module.
- [x] Run the targeted test and full test suite.

### Task 2: Windows Packaging

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.mjs`

- [x] Add Electron Builder as a development dependency.
- [x] Add the Windows distribution command and NSIS metadata.
- [x] Include compiled Next files, Electron files, and production dependencies.
- [x] Unpack the native SQLite binary from the application archive.
- [x] Produce and inspect a local unpacked application where supported.

### Task 3: GitHub Actions Artifact

**Files:**
- Create: `.github/workflows/windows-installer.yml`
- Modify: `README.md`

- [x] Add a manually triggered and tag-triggered Windows workflow.
- [x] Install dependencies, run tests, build the installer, and upload the `.exe`.
- [x] Document how the owner builds and downloads the installer.
- [x] Document the unsigned Windows SmartScreen warning.

### Task 4: Verification

**Files:**
- Verify all files above.

- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Validate Electron Builder configuration.
- [x] Check the Git diff for secrets and ignored local files.
- [x] Report the exact GitHub workflow required to obtain the first `.exe`.
