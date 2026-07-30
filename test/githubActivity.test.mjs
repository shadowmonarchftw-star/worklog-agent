import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityResult,
  extractCommitAuthors,
  formatPullRequestActivity,
  formatRepositoryActivity,
  normalizeToken,
} from "../lib/githubActivity.mjs";

test("buildActivityResult returns selected-repository metrics", () => {
  const result = buildActivityResult({
    date: "2026-07-30",
    repos: ["owner/app", "owner/api"],
    commitResults: [
      {
        repo: "owner/app",
        commits: [
          { sha: "abcdef123", commit: { message: "Fix app", author: { date: "2026-07-30T08:00:00Z" } } },
        ],
      },
      { repo: "owner/api", commits: [] },
    ],
    prGroups: {
      "owner/app": [{ number: 1, title: "App PR", stateLabel: "merged PR" }],
      "other/repo": [{ number: 2, title: "Unselected", stateLabel: "PR activity" }],
    },
  });

  assert.equal(result.date, "2026-07-30");
  assert.equal(result.commitCount, 1);
  assert.equal(result.pullRequestCount, 1);
  assert.equal(result.repoCount, 2);
  assert.match(result.activity, /owner\/app/);
  assert.doesNotMatch(result.activity, /Unselected/);
  assert.match(result.activity, /No commits or PR activity/);
});

test("formatCommitActivity groups commits under the repo name", () => {
  const activity = formatRepositoryActivity({
    repoFullName: "owner/app",
    commits: [
      {
        sha: "1234567890abcdef",
        commit: {
          message: "fix dashboard export state\n\nextra details",
          author: { name: "Asha", date: "2026-07-23T10:00:00Z" },
        },
        html_url: "https://github.com/owner/app/commit/1234567",
      },
    ],
  });

  assert.match(activity, /repo: owner\/app/);
  assert.match(activity, /10:00 commit 1234567 fix dashboard export state/);
  assert.match(activity, /by Asha/);
  assert.doesNotMatch(activity, /extra details/);
});

test("formatCommitActivity explains when no commits are found", () => {
  const activity = formatRepositoryActivity({
    repoFullName: "owner/app",
    commits: [],
    pullRequests: [],
  });

  assert.equal(activity, "repo: owner/app\n- No commits or PR activity found for this date.");
});

test("formatRepositoryActivity includes pull requests with state", () => {
  const activity = formatRepositoryActivity({
    repoFullName: "owner/app",
    commits: [],
    pullRequests: [
      {
        number: 42,
        title: "Improve export table",
        html_url: "https://github.com/owner/app/pull/42",
        stateLabel: "merged PR",
      },
    ],
  });

  assert.match(activity, /repo: owner\/app/);
  assert.match(activity, /merged PR #42 Improve export table/);
});

test("formatPullRequestActivity maps GitHub search issues into repo groups", () => {
  const groups = formatPullRequestActivity([
    {
      repository_url: "https://api.github.com/repos/owner/app",
      number: 42,
      title: "Improve export table",
      pull_request: { merged_at: "2026-07-23T10:00:00Z" },
    },
  ]);

  assert.deepEqual(groups, {
    "owner/app": [
      {
        number: 42,
        title: "Improve export table",
        stateLabel: "merged PR",
      },
    ],
  });
});

test("normalizeToken rejects non-ascii copied token text", () => {
  assert.throws(() => normalizeToken("github_pat_abc—bad"), /plain token/i);
});

test("normalizeToken trims valid token text", () => {
  assert.equal(normalizeToken("  github_pat_abc123  "), "github_pat_abc123");
});

test("extractCommitAuthors returns unique GitHub logins first", () => {
  const authors = extractCommitAuthors([
    {
      author: { login: "asha" },
      commit: { author: { name: "Asha Local" } },
    },
    {
      author: null,
      commit: { author: { name: "Sam Local" } },
    },
    {
      author: { login: "asha" },
      commit: { author: { name: "Asha Local" } },
    },
  ]);

  assert.deepEqual(authors, [
    { value: "asha", label: "asha" },
    { value: "Sam Local", label: "Sam Local" },
  ]);
});

test("extractCommitAuthors can include authenticated user first", () => {
  const authors = extractCommitAuthors(
    [
      {
        author: { login: "sam" },
        commit: { author: { name: "Sam Local" } },
      },
    ],
    { currentUser: { login: "asha" } },
  );

  assert.deepEqual(authors, [
    { value: "asha", label: "asha" },
    { value: "sam", label: "sam" },
  ]);
});

test("formatRepositoryActivity includes local time from commit author date", () => {
  const activity = formatRepositoryActivity({
    repoFullName: "owner/app",
    commits: [
      {
        sha: "abcdef1234567890",
        commit: {
          message: "restore rate data",
          author: { name: "Asha", date: "2026-07-23T14:35:00Z" },
        },
      },
    ],
  });

  assert.match(activity, /14:35 commit abcdef1 restore rate data/);
});
