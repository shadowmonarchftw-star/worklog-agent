# AI Worklog Agent

AI Worklog Agent is a local desktop app that reads your GitHub commits and pull
requests, generates a daily work summary with Gemini, saves local history in
SQLite, and can write the result to a Google Sheet.

Each developer uses their own GitHub token, Gemini API key, GitHub author, and
local settings.

## Windows Installation

### Download the installer

Open the repository's **Actions** tab, select the latest successful **Build
Windows Installer** run, and download the `AI-Worklog-Agent-Windows` artifact.
Extract the ZIP and run `AI Worklog Agent-Setup-0.1.0.exe`.

The installer is currently unsigned. Windows SmartScreen may show an
**Unknown publisher** warning. Click **More info**, confirm the file came from
this repository, and choose **Run anyway**.

When an installer artifact is not available, use the source installation below.

### Install from source

### 1. Install the prerequisites

Install:

- [Node.js LTS](https://nodejs.org/)
- [Git for Windows](https://git-scm.com/download/win)

Use the default options in both installers.

### 2. Download and start the app

Open PowerShell and run:

```powershell
git clone https://github.com/shadowmonarchftw-star/worklog-agent.git
cd worklog-agent
npm install
npm run desktop
```

The first start can take a minute. If Windows Firewall asks for permission,
allow Node.js on private networks.

For later starts, open PowerShell in the `worklog-agent` folder and run:

```powershell
npm run desktop
```

## One-Time Setup

Open Settings in the app and provide:

1. **GitHub fine-grained token** - create one in GitHub under Settings,
   Developer settings, Personal access tokens, Fine-grained tokens. Give it
   read access to the repositories and repository metadata you want to use.
2. **Gemini API key** - create one in
   [Google AI Studio](https://aistudio.google.com/app/apikey).
3. **Developer name** - the name used in generated worklogs.
4. **GitHub commit author** - select your own GitHub username so the app only
   reads your commits from shared repositories.
5. **Repositories** - load and select the repositories used for your worklog.
6. **Summary style** - choose the output format you prefer.

Settings and credentials are stored only in the app's local SQLite database on
that computer. Do not share tokens or commit them to Git.

## Google Sheets Setup

The person managing the Google Cloud project must complete these steps once:

1. Enable the
   [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com).
2. Configure the OAuth consent screen.
3. While the OAuth app is in Testing mode, add each colleague's Google email
   under **Google Auth Platform > Audience > Test users**.
4. Create an OAuth client and add this authorized redirect URI:

```text
http://127.0.0.1:3000/api/google/callback
```

Each colleague then enters the following in the app's Settings:

- Google Client ID
- Google Client Secret
- Current month's Google Sheet link
- Exact sheet tab name, for example `Sheet1` or `July`
- Default hours

Click **Connect Google**, sign in using a Google account that can edit the
sheet, and approve access.

When the office creates a new sheet next month, replace only the Google Sheet
link and tab name in Settings. Google does not need to be reconnected unless
access was revoked or the OAuth configuration changed.

## Daily Use

1. Open the app with `npm run desktop`.
2. Select the work date.
3. Click **Generate Worklog**.
4. Review the generated summary.

If Google Sheets is connected, the app finds the matching date in column A and
updates that row. If the date does not exist, it appends a new row. The office
sheet mapping is:

| Column | Value |
| --- | --- |
| A | Date |
| B | Generated task summary |
| C | Task reference |
| D | Hours |
| E | Comments |

## Local Data

Settings, credentials, Google tokens, and summary history are stored locally:

Windows:

```text
%APPDATA%\AI Worklog Agent\worklog.sqlite
```

macOS:

```text
~/Library/Application Support/AI Worklog Agent/worklog.sqlite
```

Deleting this database resets the app and removes its locally saved settings.

## Troubleshooting

### Google says "Access blocked"

The Google OAuth app is in Testing mode. Add the colleague's Google email under
**Google Auth Platform > Audience > Test users**, wait a minute, and connect
again.

### Google Sheets API returns `403 SERVICE_DISABLED`

Enable the Google Sheets API in the same Google Cloud project used by the OAuth
client. Wait a few minutes, then generate the worklog again.

### Google sign-in or passkey verification is stuck

Close the old sign-in window, restart the desktop app, and reconnect. Google
sign-in opens in the system browser so passkeys can work normally.

### PowerShell cannot find `npm` or `git`

Close and reopen PowerShell after installing Node.js or Git. If the command is
still unavailable, restart Windows and try again.

## Development Commands

Run the web interface:

```bash
npm run dev
```

Run the Electron desktop app:

```bash
npm run desktop
```

Run tests:

```bash
npm test
```

Create a production Next.js build:

```bash
npm run build
```

Build the Windows installer on a Windows computer:

```powershell
npm run dist:win
```

The installer is written to the `release` folder.

## Creating a Windows Installer on GitHub

Repository maintainers can create a new installer without a Windows computer:

1. Open the repository on GitHub.
2. Select **Actions**.
3. Select **Build Windows Installer**.
4. Click **Run workflow** and choose the `master` branch.
5. Wait for the workflow to finish.
6. Open the completed run and download `AI-Worklog-Agent-Windows` under
   **Artifacts**.

Pushing a version tag such as `v0.1.0` also starts the installer workflow.
