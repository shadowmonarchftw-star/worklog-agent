# Standalone Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Windows and macOS installer sizes while preserving the verified packaged runtime.

**Architecture:** Next.js emits a traced standalone server containing only production runtime files. Electron Builder packages Electron code separately and copies the standalone server as an unpacked resource so native SQLite resolution works on macOS and Windows.

**Tech Stack:** Next.js standalone output, Electron, Electron Builder, better-sqlite3, GitHub Actions

---

### Task 1: Standalone Runtime

**Files:**
- Modify: `next.config.mjs`
- Modify: `electron/app-server.cjs`
- Test: `test/appServer.test.mjs`

- [x] Add failing tests for the packaged standalone server path and child process.
- [x] Enable Next.js standalone output.
- [x] Launch the standalone server with Electron's Node runtime in packaged mode.
- [x] Keep development and external URL behavior unchanged.

### Task 2: Minimal Package Contents

**Files:**
- Modify: `package.json`
- Test: `test/packageConfig.test.mjs`

- [x] Add failing assertions for minimal Electron files and standalone resources.
- [x] Package Electron files only in the application bundle.
- [x] Copy standalone output and static assets as resources.
- [x] Enable maximum installer compression.

### Task 3: Windows and macOS Verification

**Files:**
- Modify: `README.md`
- Verify: `.github/workflows/windows-installer.yml`
- Verify: `.github/workflows/macos-installer.yml`

- [x] Document Windows SmartScreen behavior and confirm the blank-screen fix is shared.
- [x] Build and run the optimized macOS package.
- [x] Verify root, SQLite API, JavaScript, and CSS responses.
- [x] Compare old and optimized DMG sizes.
- [x] Run all tests and the production build.
- [x] Publish a new version tag for both installer workflows.
