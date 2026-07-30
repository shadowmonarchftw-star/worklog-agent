import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/github/activity/route.js";

test("activity route returns exact structured metrics", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).includes("/search/issues")) {
      return Response.json({
        items: [
          {
            repository_url: "https://api.github.com/repos/owner/app",
            number: 4,
            title: "Ship UI",
            pull_request: { merged_at: "2026-07-30T10:00:00Z" },
          },
        ],
      });
    }
    return Response.json([
      {
        sha: "abcdef123",
        commit: {
          message: "Build dashboard",
          author: { name: "Asha", date: "2026-07-30T09:00:00Z" },
        },
      },
    ]);
  };

  const response = await POST(
    new Request("http://localhost/api/github/activity", {
      method: "POST",
      body: JSON.stringify({
        githubToken: "github_pat_valid",
        repoFullNames: ["owner/app"],
        date: "2026-07-30",
        author: "asha",
      }),
    }),
  );
  const data = await response.json();

  assert.deepEqual(Object.keys(data).sort(), [
    "activity",
    "commitCount",
    "date",
    "pullRequestCount",
    "repoCount",
  ]);
  assert.equal(data.commitCount, 1);
  assert.equal(data.pullRequestCount, 1);
  assert.equal(data.repoCount, 1);
  assert.equal(data.date, "2026-07-30");
});
