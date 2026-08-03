import assert from "node:assert/strict";
import test from "node:test";

import {
  UNREADABLE_CREDENTIALS_FIELD,
  protectSetting,
  revealSetting,
  unreadableCredentials,
} from "../lib/secureSettings.mjs";

function withKey(value, run) {
  const previous = process.env.WORKLOG_AGENT_CREDENTIAL_KEY;
  if (value === null) delete process.env.WORKLOG_AGENT_CREDENTIAL_KEY;
  else process.env.WORKLOG_AGENT_CREDENTIAL_KEY = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.WORKLOG_AGENT_CREDENTIAL_KEY;
    else process.env.WORKLOG_AGENT_CREDENTIAL_KEY = previous;
  }
}

test("secret settings round-trip through seal and open", () => {
  withKey("key-one", () => {
    const sealed = protectSetting("app-settings", {
      githubToken: "ghp_secret",
      githubAuthor: "asha",
    });
    assert.equal(sealed.githubToken.__encrypted, true);
    assert.equal(sealed.githubAuthor, "asha");

    const revealed = revealSetting("app-settings", sealed);
    assert.equal(revealed.githubToken, "ghp_secret");
    assert.equal(revealed.githubAuthor, "asha");
    assert.deepEqual(unreadableCredentials(revealed), []);
  });
});

test("a changed credential key reports unreadable secrets instead of empty ones", () => {
  const sealed = withKey("key-one", () => protectSetting("app-settings", {
    githubToken: "ghp_secret",
    geminiApiKey: "gem_secret",
  }));

  const revealed = withKey("key-two", () => revealSetting("app-settings", sealed));
  assert.equal(revealed.githubToken, "");
  assert.deepEqual(
    unreadableCredentials(revealed).sort(),
    ["geminiApiKey", "githubToken"],
  );
});

test("a missing credential key reports unreadable secrets", () => {
  const sealed = withKey("key-one", () => protectSetting("app-settings", {
    githubToken: "ghp_secret",
  }));

  const revealed = withKey(null, () => revealSetting("app-settings", sealed));
  assert.equal(revealed.githubToken, "");
  assert.deepEqual(unreadableCredentials(revealed), ["githubToken"]);
});

test("google tokens round-trip and report loss when the key changes", () => {
  const sealed = withKey("key-one", () => protectSetting("google-tokens", {
    access_token: "at",
    refresh_token: "rt",
  }));

  assert.deepEqual(
    withKey("key-one", () => revealSetting("google-tokens", sealed)),
    { access_token: "at", refresh_token: "rt" },
  );

  const lost = withKey("key-two", () => revealSetting("google-tokens", sealed));
  assert.equal(lost.access_token, undefined);
  assert.deepEqual(unreadableCredentials(lost), ["googleTokens"]);
});

test("settings pass through unchanged when no credential key is configured", () => {
  withKey(null, () => {
    const stored = protectSetting("app-settings", { githubToken: "ghp_plain" });
    assert.equal(stored.githubToken, "ghp_plain");
    assert.equal(revealSetting("app-settings", stored).githubToken, "ghp_plain");
  });
});

test("the unreadable marker is only added when something actually failed", () => {
  withKey("key-one", () => {
    const revealed = revealSetting("app-settings", protectSetting("app-settings", {
      githubToken: "ghp_secret",
    }));
    assert.equal(UNREADABLE_CREDENTIALS_FIELD in revealed, false);
  });
});
