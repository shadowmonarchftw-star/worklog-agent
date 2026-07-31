import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectLocalGitActivity,
  inspectLocalRepository,
} from "../lib/localGitProvider.mjs";

function git(cwd, args, env = {}) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

function repo(name, email) {
  const dir = mkdtempSync(path.join(tmpdir(), "worklog-local-git-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", name]);
  git(dir, ["config", "user.email", email]);
  return dir;
}

function commit(dir, file, subject, {
  name = "Asha",
  email = "asha@work.test",
  date = "2026-07-31T09:00:00+05:45",
} = {}) {
  writeFileSync(path.join(dir, file), subject);
  git(dir, ["add", file]);
  git(dir, ["commit", "-m", subject], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: date,
  });
}

test("collects unpushed commits from all local branches and ignores dirty state", async () => {
  const dir = repo("Asha", "asha@work.test");
  commit(dir, "main.txt", "main work");
  git(dir, ["checkout", "-b", "feature"]);
  commit(dir, "feature.txt", "feature work");
  commit(dir, "other.txt", "other work", {
    name: "Colleague",
    email: "colleague@work.test",
  });
  writeFileSync(path.join(dir, "feature.txt"), "unstaged");
  writeFileSync(path.join(dir, "untracked.txt"), "not committed");

  const inspected = await inspectLocalRepository(dir);
  const result = await collectLocalGitActivity({
    repositories: [inspected],
    since: "2026-07-30T18:15:00.000Z",
    until: "2026-07-31T18:15:00.000Z",
    date: "2026-07-31",
    timezone: "Asia/Kathmandu",
  });

  assert.equal(result.commitCount, 2);
  assert.match(result.activity, /main work/);
  assert.match(result.activity, /feature work/);
  assert.match(result.activity, /09:00 commit/);
  assert.doesNotMatch(result.activity, /other work|unstaged|not committed/);
});

test("combines repositories with different detected account identities", async () => {
  const work = repo("Asha Work", "asha@company.test");
  const personal = repo("Asha Personal", "asha@personal.test");
  commit(work, "work.txt", "company task", {
    name: "Asha Work",
    email: "asha@company.test",
  });
  commit(personal, "personal.txt", "personal task", {
    name: "Asha Personal",
    email: "asha@personal.test",
  });

  const result = await collectLocalGitActivity({
    repositories: await Promise.all([
      inspectLocalRepository(work),
      inspectLocalRepository(personal),
    ]),
    since: "2026-07-30T18:15:00.000Z",
    until: "2026-07-31T18:15:00.000Z",
    date: "2026-07-31",
    timezone: "Asia/Kathmandu",
  });

  assert.equal(result.commitCount, 2);
  assert.equal(result.repoCount, 2);
});
