# GitHub Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish permanent Windows and macOS installers to one GitHub Release for every version tag.

**Architecture:** Convert both installer workflows to reusable/manual builders, then add a tag workflow that calls them and publishes their artifacts after every build succeeds.

**Tech Stack:** GitHub Actions, GitHub CLI, Electron Builder.

---

### Task 1: Reusable Builders

**Files:**
- Modify: `.github/workflows/windows-installer.yml`
- Modify: `.github/workflows/macos-installer.yml`

- [ ] Add `workflow_call` and retain `workflow_dispatch`.
- [ ] Remove independent tag triggers.
- [ ] Preserve tests, smoke checks, and uploaded artifacts.

### Task 2: Release Publisher

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] Trigger on `v*` tags.
- [ ] Call both reusable builders.
- [ ] Download all installer artifacts after both succeed using
  `merge-multiple: true`.
- [ ] Use per-tag concurrency, create the release only when missing, and upload
  all assets with `gh release upload --clobber`.

### Task 3: Documentation and Verification

**Files:**
- Modify: `README.md`

- [ ] Document Releases as the normal download location.
- [ ] Parse all workflow YAML.
- [ ] Run repository tests and `git diff --check`.
- [ ] Merge, push, and test with the next version tag.
