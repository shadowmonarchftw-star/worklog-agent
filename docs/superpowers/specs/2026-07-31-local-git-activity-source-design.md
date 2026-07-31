# Local Git Activity Source Design

## Goal

Allow each user to choose one global activity source for daily worklogs:

- **GitHub** reads pushed commits and pull-request activity through the existing
  GitHub API integration.
- **Local repositories** reads committed work directly from repositories on the
  user's computer, including commits that have not been pushed.

Local mode includes completed commits only. It must never include staged,
unstaged, or untracked changes.

## Product Behavior

The Git settings page gains an activity-source segmented control. Switching
sources preserves both configurations, but only the selected source is used for
manual and automatic worklogs.

GitHub mode retains the existing token, account author, repository loading, and
repository selection controls.

Local mode provides:

- An **Add repository** button that opens the native desktop folder picker.
- A list of selected repository folders with repository name, path, detected
  author identity, status, and a remove action.
- Per-repository author controls containing the detected Git name and email.
- An optional per-repository override supporting one or more accepted author
  emails or names.
- Clear states for missing folders, folders that are not Git repositories, Git
  not being installed, and repositories that cannot be read.

The setup remains minimal: adding a repository detects its identity
automatically. Most users do not need to edit anything.

## Identity Model

Identity is resolved independently for every selected repository:

1. Read repository-local `user.name` and `user.email`.
2. Fall back to global Git configuration when repository-local values are
   absent.
3. Combine the detected identity with optional accepted-name and accepted-email
   overrides saved for that repository.
4. Match commits case-insensitively by author email first and author name
   second.

This supports users who use separate company, personal, and client GitHub
accounts. Identity overrides also cover historical commits made with an older
email address.

Repository paths and identity overrides are stored only in local SQLite.

## Local Git Provider

Local collection uses the system Git executable. The desktop app invokes Git
without a shell and passes arguments as an array to avoid command injection.

For each selected repository:

1. Validate the saved path and confirm it is a Git work tree.
2. Resolve the repository display name and configured identity.
3. Run `git log --all` for the selected local-day time range.
4. Emit a machine-readable delimiter format containing full SHA, author name,
   author email, author date, and subject.
5. Filter by the repository's accepted identities.
6. Deduplicate by full SHA.
7. Normalize commits into the same activity shape consumed by Gemini.

`--all` includes commits reachable from every local ref, not only the currently
checked-out branch. Merge commits are included because they are completed
commits. Staged, unstaged, and untracked state is never queried.

Local mode reports zero pull requests because pull requests are remote hosting
objects. GitHub mode continues to include pull-request activity.

## Architecture

### Settings

Add persisted fields:

- `activitySource`: `"github"` or `"local"`, defaulting to `"github"` for
  existing installations.
- `localRepositories`: array of repository records containing a stable ID,
  canonical path, display name, detected identity, accepted identity
  overrides, and last validation status.

Secrets and paths remain excluded from worklog history entries.

### Desktop Bridge

Electron preload exposes narrowly scoped methods:

- `chooseLocalRepository()` opens a directory picker and returns a selected
  path or cancellation.
- `inspectLocalRepository(path)` validates the repository and returns safe
  metadata.

Browser development mode cannot access arbitrary local folders. The local mode
UI remains visible but explains that repository selection and collection
require the desktop app.

### Providers

The workflow receives one activity provider selected from settings:

- `githubProvider` for GitHub mode.
- `localGitProvider` for local mode.

Both return the existing normalized result:

```text
activity
commitCount
pullRequestCount
repoCount
date
```

The rest of the pipeline remains unchanged: Gemini generation, local history,
Google Sheets writing, retries, recovery, notifications, and scheduling.

### Validation

Setup requirements become source-aware:

- GitHub mode requires token, GitHub author, and selected GitHub repositories.
- Local mode requires at least one valid local repository and at least one
  accepted detected or overridden identity for every included repository.
- Both modes still require Gemini and Google Sheets settings for automatic
  writes.

The dashboard describes the active source and monitored repository count.

## Time Handling

The scheduler already calculates a local work date and UTC boundaries. The
local provider passes those boundaries to Git and evaluates author timestamps,
so manual and automatic runs use the same local-day definition as GitHub mode.

Commit time shown in activity is converted to the user's local timezone.

## Failure Handling

- If Git is unavailable, stop before claiming an automation attempt and show
  installation guidance.
- If every selected repository is unavailable or invalid, fail with an
  actionable setup error.
- If some repositories are unavailable, collect healthy repositories and
  include a warning in the run result and desktop notification.
- A repository with no matching commits is healthy and contributes zero
  activity.
- Git command errors are sanitized before being stored or shown.
- Paths and command output are never sent to Gemini; only normalized repository
  names and matching commit metadata are included.

Repeated manual runs continue to update the same date safely using stable
history IDs.

## Security

- Use `execFile`, not shell execution.
- Pass `--` before path-like Git arguments where applicable.
- Canonicalize and validate every selected path.
- Never interpolate repository paths or author values into command strings.
- Limit Git output size and process duration.
- Redact absolute paths from persisted provider errors and generated summaries.
- Keep local repository paths in local settings only.

## Testing

Unit tests cover:

- Parsing delimiter-safe Git output.
- Local-day filtering and timezone boundaries.
- All-ref deduplication by SHA.
- Per-repository detected identity and multiple override identities.
- Source-aware setup validation.
- Partial repository failure and total failure.
- Path/error redaction.

Integration tests create temporary Git repositories and verify:

- Commits on multiple branches are collected once.
- Unpushed commits are included.
- Commits from another author are excluded.
- Staged, unstaged, and untracked changes are excluded.
- Multiple repositories with different identities contribute to one worklog.

Electron tests cover folder-picker cancellation, invalid-folder results, and
the restricted preload bridge. UI tests cover mode switching, preserved
settings, local repository states, and automation readiness.

The complete existing test suite, production build, and packaged macOS smoke
test must pass. GitHub Actions continues to verify Windows and macOS packages.

## Compatibility

Existing users remain in GitHub mode after upgrading. Existing GitHub settings,
automation schedules, Google credentials, history, and sheet mappings are not
migrated or removed.

The feature supports macOS and Windows. Git must be installed and available to
the desktop process; when it is not, the UI provides a platform-appropriate
message rather than silently falling back to GitHub.
