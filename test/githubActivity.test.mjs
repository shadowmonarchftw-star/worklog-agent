import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPullRequestActivity,
  formatRepositoryActivity,
  normalizeToken,
} from "../lib/githubActivity.mjs";

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
  assert.match(activity, /commit 1234567 fix dashboard export state/);
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
