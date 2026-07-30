# AI Worklog Agent Prototype

Local prototype for turning pasted GitHub commits and PR notes into a daily work-log summary.

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Add your Gemini API key. Easiest path: paste it into the app UI.

Optional local-env path: create `.env.local` from `.env.example`.

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.6-flash
```

3. Start the app:

```bash
npm run dev
```

4. Open the local URL printed by Next.js.

## Run Desktop App

```bash
npm run desktop
```

This opens the same prototype in an Electron desktop window and stores browser-local history inside the desktop app profile.

## Local Data

The desktop prototype stores settings and summary history in SQLite:

Mac:

```text
~/Library/Application Support/AI Worklog Agent/worklog.sqlite
```

Windows:

```text
%APPDATA%/AI Worklog Agent/worklog.sqlite
```

## Current Scope

- Paste GitHub activity manually.
- Choose developer, date, and summary style.
- Generate a daily work-log summary with AI.
- Save generated summaries in browser-local history.

## Next Milestones

- Connect GitHub OAuth.
- Let user select repositories.
- Save summary history.
- Add scheduled email delivery.
