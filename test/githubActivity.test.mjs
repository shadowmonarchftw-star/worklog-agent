import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityResult,
  extractCommitAuthors,
  filterCommitsByRange,
  formatPullRequestActivity,
  formatRepositoryActivity,
  normalizeToken,
} from "../lib/githubActivity.mjs";
import { localDayUtcRange } from "../lib/localDate.mjs";
import { POST } from "../app/api/github/activity/route.js";

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

test("pull request activity includes Kathmandu since and excludes until", () => {
  const range = localDayUtcRange("2026-07-30", "Asia/Kathmandu");
  const item = (number, updatedAt) => ({
    repository_url: "https://api.github.com/repos/owner/app",
    number,
    title: `PR ${number}`,
    updated_at: updatedAt,
    pull_request: { merged_at: null },
  });

  const groups = formatPullRequestActivity(
    [
      item(1, "2026-07-29T18:14:59.999Z"),
      item(2, range.since),
      item(3, "2026-07-30T18:14:59.999Z"),
      item(4, range.until),
    ],
    range,
  );

  assert.deepEqual(
    groups["owner/app"].map(({ number }) => number),
    [2, 3],
  );
});

test("commit activity includes since and excludes until across New York DST", () => {
  const range = localDayUtcRange("2026-03-08", "America/New_York");
  const commit = (sha, date) => ({
    sha,
    commit: { author: { date }, committer: { date } },
  });

  const commits = filterCommitsByRange(
    [
      commit("before", "2026-03-08T04:59:59.999Z"),
      commit("since", range.since),
      commit("inside", "2026-03-09T03:59:59.999Z"),
      commit("until", range.until),
    ],
    range,
  );

  assert.deepEqual(
    commits.map(({ sha }) => sha),
    ["since", "inside"],
  );
});

test("activity collection honors explicit UTC boundaries", async (t) => {
  const originalFetch = globalThis.fetch;
  const range = localDayUtcRange("2026-07-30", "Asia/Kathmandu");
  const requestedUrls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes("/search/issues")) {
      return Response.json({
        items: [
          {
            repository_url: "https://api.github.com/repos/owner/app",
            number: 1,
            title: "At since",
            updated_at: range.since,
            pull_request: { merged_at: null },
          },
          {
            repository_url: "https://api.github.com/repos/owner/app",
            number: 2,
            title: "At until",
            updated_at: range.until,
            pull_request: { merged_at: null },
          },
        ],
      });
    }
    return Response.json([
      {
        sha: "since",
        commit: { message: "At since", author: { date: range.since } },
      },
      {
        sha: "until",
        commit: { message: "At until", author: { date: range.until } },
      },
    ]);
  };

  const response = await POST(new Request("http://localhost/api/github/activity", {
    method: "POST",
    body: JSON.stringify({
      githubToken: "github_pat_valid",
      repoFullNames: ["owner/app"],
      date: "2026-07-30",
      author: "asha",
      ...range,
    }),
  }));
  const result = await response.json();
  const commitUrl = new URL(requestedUrls.find((url) => url.includes("/commits?")));
  const searchUrl = new URL(requestedUrls.find((url) => url.includes("/search/issues")));

  assert.equal(commitUrl.searchParams.get("since"), range.since);
  assert.equal(commitUrl.searchParams.get("until"), range.until);
  assert.match(searchUrl.searchParams.get("q"), /updated:2026-07-29\.\.2026-07-30/);
  assert.equal(result.commitCount, 1);
  assert.equal(result.pullRequestCount, 1);
  assert.match(result.activity, /At since/);
  assert.doesNotMatch(result.activity, /At until/);
});

test("date-only activity collection preserves the inclusive legacy default", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).includes("/search/issues")) {
      return Response.json({
        items: [{
          repository_url: "https://api.github.com/repos/owner/app",
          number: 1,
          title: "Last millisecond PR",
          pull_request: { merged_at: "2026-07-30T23:59:59.999Z" },
        }],
      });
    }
    return Response.json([{
      sha: "last",
      commit: {
        message: "Last millisecond commit",
        author: { date: "2026-07-30T23:59:59.999Z" },
      },
    }]);
  };

  const response = await POST(new Request("http://localhost/api/github/activity", {
    method: "POST",
    body: JSON.stringify({
      githubToken: "github_pat_valid",
      repoFullNames: ["owner/app"],
      date: "2026-07-30",
      author: "asha",
    }),
  }));
  const result = await response.json();

  assert.equal(result.commitCount, 1);
  assert.equal(result.pullRequestCount, 1);
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
