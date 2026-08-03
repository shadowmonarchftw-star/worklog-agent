import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";

import { formatRepositoryActivity } from "./githubActivity.mjs";
import { isExcludedCommit, parseExcludePatterns } from "./commitFilters.mjs";
import { ProviderError } from "./providerError.mjs";

const execFileAsync = promisify(execFile);
const GIT_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 5 * 1024 * 1024,
  timeout: 10_000,
  windowsHide: true,
};

async function git(repositoryPath, args, options = {}) {
  return execFileAsync("git", ["-C", repositoryPath, ...args], {
    ...GIT_OPTIONS,
    ...options,
  });
}

function values(items) {
  return [...new Set((items || []).map((item) => item?.trim().toLowerCase()).filter(Boolean))];
}

export function repositoryIdentity(repository) {
  return {
    emails: values([
      repository.detectedEmail,
      ...(repository.acceptedEmails || []),
    ]),
    names: values([
      repository.detectedName,
      ...(repository.acceptedNames || []),
    ]),
  };
}

export function matchesIdentity(commit, identity) {
  const emails = values(identity?.emails);
  if (emails.length) return emails.includes(commit.email?.trim().toLowerCase());
  return values(identity?.names).includes(commit.name?.trim().toLowerCase());
}

export function parseGitLog(output) {
  const fields = output.split("\0");
  const commits = [];
  for (let index = 0; index + 4 < fields.length; index += 5) {
    const [sha, name, email, authoredAt, subject] = fields.slice(index, index + 5);
    if (!sha) continue;
    commits.push({ sha: sha.trim(), name, email, authoredAt, subject });
  }
  return commits;
}

export function sanitizeGitError(_error, _repositoryPath, displayName = "repository") {
  return `Could not read local repository "${displayName}".`;
}

function stableRepositoryId(repositoryPath) {
  return createHash("sha256").update(repositoryPath).digest("hex").slice(0, 16);
}

export async function inspectLocalRepository(repositoryPath) {
  const canonicalPath = await realpath(repositoryPath);
  try {
    const [{ stdout: root }, { stdout: name }, { stdout: email }] = await Promise.all([
      git(canonicalPath, ["rev-parse", "--show-toplevel"]),
      git(canonicalPath, ["config", "--get", "user.name"]).catch(() => ({ stdout: "" })),
      git(canonicalPath, ["config", "--get", "user.email"]).catch(() => ({ stdout: "" })),
    ]);
    const resolvedRoot = await realpath(root.trim());
    return {
      id: stableRepositoryId(resolvedRoot),
      path: resolvedRoot,
      displayName: path.basename(resolvedRoot),
      detectedName: name.trim(),
      detectedEmail: email.trim(),
      acceptedNames: [],
      acceptedEmails: [],
      status: "ready",
    };
  } catch {
    throw new ProviderError("local-git", "The selected folder is not a readable Git repository.");
  }
}

async function localBranchRefs(repositoryPath) {
  const { stdout } = await git(repositoryPath, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads/",
  ]);
  return stdout.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean);
}

async function commitsFor(repository, { since, until, signal }) {
  const refs = await localBranchRefs(repository.path);
  if (!refs.length) return [];
  const { stdout } = await git(repository.path, [
    "log",
    "-z",
    "--format=%H%x00%an%x00%ae%x00%aI%x00%s",
    ...refs,
  ], { signal });
  const start = new Date(since).getTime();
  const end = new Date(until).getTime();
  const identity = repositoryIdentity(repository);
  const seen = new Set();
  return parseGitLog(stdout).filter((commit) => {
    const instant = new Date(commit.authoredAt).getTime();
    if (!Number.isFinite(instant) || instant < start || instant >= end) return false;
    if (!matchesIdentity(commit, identity) || seen.has(commit.sha)) return false;
    seen.add(commit.sha);
    return true;
  });
}

export async function preflightLocalGit({ repositories = [] } = {}) {
  try {
    await execFileAsync("git", ["--version"], GIT_OPTIONS);
  } catch {
    throw new ProviderError(
      "local-git",
      "Git is not installed or is unavailable. Install Git and restart the app.",
    );
  }
  if (!repositories.length) {
    throw new ProviderError("local-git", "Add at least one local Git repository.");
  }
  if (repositories.some((repository) => {
    const identity = repositoryIdentity(repository);
    return !identity.emails.length && !identity.names.length;
  })) {
    throw new ProviderError(
      "local-git",
      "Every local repository needs a detected Git identity or author override.",
    );
  }
  const checks = await Promise.all(repositories.map((repository) =>
    git(repository.path, ["rev-parse", "--is-inside-work-tree"])
      .then(({ stdout }) => stdout.trim() === "true")
      .catch(() => false)));
  if (!checks.some(Boolean)) {
    throw new ProviderError(
      "local-git",
      "None of the selected local repositories can be read.",
    );
  }
}

export async function collectLocalGitActivity({
  repositories = [],
  date,
  since,
  until,
  timezone,
  signal,
  excludeCommitPatterns = "",
}) {
  await preflightLocalGit({ repositories });
  const groups = await Promise.all(repositories.map(async (repository) => {
    try {
      const patterns = parseExcludePatterns(
        excludeCommitPatterns,
        repository.excludeCommitPatterns,
      );
      const commits = (await commitsFor(repository, { since, until, signal }))
        .filter((commit) => !isExcludedCommit(commit.subject, patterns));
      return { repository, commits };
    } catch (error) {
      return {
        repository,
        error: sanitizeGitError(error, repository.path, repository.displayName),
      };
    }
  }));
  const healthy = groups.filter((group) => !group.error);
  const warnings = groups.filter((group) => group.error).map((group) => group.error);
  if (!healthy.length) {
    throw new ProviderError("local-git", warnings[0] || "No local repositories could be read.");
  }
  return {
    activity: healthy.map(({ repository, commits }) => formatRepositoryActivity({
      repoFullName: repository.displayName,
      timeZone: timezone,
      commits: commits.map((commit) => ({
        sha: commit.sha,
        commit: {
          message: commit.subject,
          author: { name: commit.name, date: commit.authoredAt },
        },
      })),
    })).join("\n\n"),
    commitCount: healthy.reduce((total, group) => total + group.commits.length, 0),
    pullRequestCount: 0,
    repoCount: healthy.length,
    date,
    warnings,
  };
}

export const localGitProvider = {
  preflight: ({ settings }) => preflightLocalGit({
    repositories: settings.localRepositories,
  }),
  collectActivity: ({ repos, ...input }) => collectLocalGitActivity({
    repositories: repos,
    ...input,
  }),
};
