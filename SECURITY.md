# Security Policy

## Supported versions

Only the latest published release receives security fixes. Older versions are
not patched. Please update before reporting an issue.

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public issue.

- Preferred: GitHub **Security** tab → **Report a vulnerability** (private
  advisory).
- Alternative: email `shadowmonarchftw@gmail.com` with `SECURITY` in the
  subject.

Please include:

- affected version and operating system,
- steps to reproduce, and
- what an attacker gains.

Expect an acknowledgement within 7 days. Please allow 90 days for a fix before
public disclosure.

## Security model

AI Worklog Agent is a local desktop application. There is no remote backend
operated by this project.

- All credentials, worklog history, and settings live in a local SQLite file in
  the operating system's per-user application data directory.
- The bundled Next.js server binds to `127.0.0.1` only. Automation routes
  additionally require a same-origin request plus a launch identity derived
  from a random nonce generated on each app start.
- Secret settings (GitHub token, Gemini API key, Google client secret, Google
  OAuth tokens) are sealed with AES-256-GCM before being stored. On desktop,
  the encryption key is generated and protected by Electron `safeStorage`,
  which is backed by the OS keychain or credential store.
- Every user supplies their own GitHub token, Gemini API key, and Google OAuth
  client. No shared or project-owned credentials are distributed with the app.
- Google Sheets writes are scoped to columns A, B, and D of the target sheet.

### Known limitations

These are accepted, documented properties rather than vulnerabilities:

- Installers are **unsigned**. Windows SmartScreen and macOS Gatekeeper will
  warn about an unknown developer. Verify downloads come from this
  repository's Releases page.
- When the app is run outside Electron (for example `npm run dev`), the
  credential encryption key may be absent. In that case secret settings are
  stored unencrypted. This is intended for local development only.
- Anyone with read access to your user account on the machine can read the
  application data directory, subject to the OS-level protection of the
  encryption key.

## Scope

In scope: the application code in this repository, its API routes, the
Electron shell, and the release/packaging workflows.

Out of scope: vulnerabilities in GitHub, Google, or Gemini services
themselves; issues requiring an already-compromised user account or physical
machine access; and unsigned-installer warnings.
