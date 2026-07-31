# GitHub Releases Design

Version tags must produce one permanent GitHub Release containing:

- Windows x64 installer (`.exe`)
- macOS Apple Silicon installer (`.dmg`)
- macOS Intel installer (`.dmg`)

GitHub Actions remains responsible for building and smoke-testing each platform.
The existing Windows and macOS workflows become reusable via `workflow_call`
and remain manually runnable via `workflow_dispatch`. They no longer react to
tags independently.

A new tag-triggered release workflow calls both reusable builders. After all
platform jobs succeed, it downloads their uploaded artifacts into one
directory and creates the release with generated notes using GitHub CLI. The
release job receives `contents: write`; builder jobs remain read-only.

A per-tag concurrency group prevents two publishers for the same tag from
running simultaneously. The publish step creates the release only when it does
not exist, then uploads every installer with `--clobber`, making reruns safe.
Downloaded platform artifacts are flattened into one release directory with
`merge-multiple: true`.

If any build or smoke test fails, the release job does not run. Re-running a
failed tag workflow must update or create the same release without duplicating
assets. Actions artifacts remain available for diagnostics.
