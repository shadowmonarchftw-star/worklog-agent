# Worklog Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local prototype that turns pasted GitHub activity into an AI-generated daily work log.

**Architecture:** A small Next.js app renders a single-page form and calls an API route. The API route validates input, builds a grounded summarization prompt, calls OpenAI through `fetch`, and returns text to the browser.

**Tech Stack:** Next.js, React, Node test runner, OpenAI Responses API through HTTP fetch.

---

### Task 1: Prompt Builder

**Files:**
- Create: `lib/summaryPrompt.mjs`
- Test: `test/summaryPrompt.test.mjs`

- [x] **Step 1: Write failing prompt tests**
- [x] **Step 2: Run tests and verify failure**
- [x] **Step 3: Implement prompt builder**
- [x] **Step 4: Run tests and verify pass**

### Task 2: Prototype App

**Files:**
- Create: `package.json`
- Create: `next.config.mjs`
- Create: `app/layout.jsx`
- Create: `app/page.jsx`
- Create: `app/api/generate-summary/route.js`
- Create: `app/globals.css`

- [x] **Step 1: Create project config**
- [x] **Step 2: Create API route using prompt builder**
- [x] **Step 3: Create form UI and result panel**
- [x] **Step 4: Verify lint/tests/build or explain blocked commands**
