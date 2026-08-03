import assert from "node:assert/strict";
import test from "node:test";

import { isExcludedCommit, parseExcludePatterns } from "../lib/commitFilters.mjs";
import { collectGithubActivity } from "../lib/githubProvider.mjs";

function fakeGithub(commits) {
  return async (url) => {
    if (String(url).includes("/search/issues")) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    return { ok: true, json: async () => commits };
  };
}

test("exclusion patterns split on commas, not on characters", () => {
  assert.deepEqual(parseExcludePatterns("merge"), ["merge"]);
  assert.deepEqual(parseExcludePatterns("merge, chore"), ["merge", "chore"]);
});

test("exclusion patterns combine global and per-repository sources", () => {
  assert.deepEqual(parseExcludePatterns("merge", "wip,typo"), ["merge", "wip", "typo"]);
});

test("exclusion patterns ignore empty and whitespace-only entries", () => {
  assert.deepEqual(parseExcludePatterns("", null, undefined, " , merge , "), ["merge"]);
});

test("an unrelated commit survives a word exclusion pattern", () => {
  const patterns = parseExcludePatterns("merge");
  assert.equal(isExcludedCommit("Add login form", patterns), false);
  assert.equal(isExcludedCommit("Merge branch 'main'", patterns), true);
});

test("no patterns means no commit is excluded", () => {
  assert.equal(isExcludedCommit("Merge branch 'main'", parseExcludePatterns("")), false);
});

test("exclusion matching is case-insensitive and handles missing messages", () => {
  const patterns = parseExcludePatterns("WIP");
  assert.equal(isExcludedCommit("wip: draft", patterns), true);
  assert.equal(isExcludedCommit(undefined, patterns), false);
});

test("GitHub activity drops only the commits matching the exclusion word", async () => {
  const result = await collectGithubActivity({
    token: "ghp_token",
    repos: ["owner/app"],
    date: "2026-07-30",
    author: "asha",
    excludeCommitPatterns: "merge",
    fetchImpl: fakeGithub([
      { sha: "aaaaaaa1", commit: { message: "Add login form" } },
      { sha: "bbbbbbb2", commit: { message: "Merge branch 'main'" } },
      { sha: "ccccccc3", commit: { message: "Fix rate importer" } },
    ]),
  });
  assert.equal(result.commitCount, 2);
  assert.match(result.activity, /Add login form/);
  assert.match(result.activity, /Fix rate importer/);
  assert.doesNotMatch(result.activity, /Merge branch/);
});

test("GitHub activity keeps every commit when no exclusion is configured", async () => {
  const result = await collectGithubActivity({
    token: "ghp_token",
    repos: ["owner/app"],
    date: "2026-07-30",
    author: "asha",
    fetchImpl: fakeGithub([
      { sha: "aaaaaaa1", commit: { message: "Add login form" } },
      { sha: "bbbbbbb2", commit: { message: "Merge branch 'main'" } },
    ]),
  });
  assert.equal(result.commitCount, 2);
});

test("per-repository filters apply on top of the global exclusion", async () => {
  const result = await collectGithubActivity({
    token: "ghp_token",
    repos: ["owner/app"],
    date: "2026-07-30",
    author: "asha",
    excludeCommitPatterns: "merge",
    repoFilters: { "owner/app": "typo" },
    fetchImpl: fakeGithub([
      { sha: "aaaaaaa1", commit: { message: "Add login form" } },
      { sha: "bbbbbbb2", commit: { message: "Merge branch 'main'" } },
      { sha: "ddddddd4", commit: { message: "Fix typo in README" } },
    ]),
  });
  assert.equal(result.commitCount, 1);
  assert.match(result.activity, /Add login form/);
});
