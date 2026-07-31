import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  shouldKeepAlive,
  shouldStartHidden,
  loginItemFor,
  normalizeDirectorySelection,
} = require("../electron/lifecycle.cjs");

test("background automation keeps the desktop process alive", () => {
  assert.equal(shouldKeepAlive({ enabled: true, startAtLogin: false }), true);
  assert.equal(shouldKeepAlive({ enabled: false, startAtLogin: true }), true);
  assert.equal(shouldKeepAlive({ enabled: false, startAtLogin: false }), false);
});

test("login launches start hidden only while background operation is configured", () => {
  assert.equal(
    shouldStartHidden({
      loginLaunch: true,
      settings: { enabled: true, startAtLogin: true },
    }),
    true,
  );
  assert.equal(
    shouldStartHidden({
      loginLaunch: false,
      settings: { enabled: true, startAtLogin: true },
    }),
    false,
  );
});

test("login item settings mirror the saved explicit preference", () => {
  assert.deepEqual(loginItemFor({ startAtLogin: true }), { openAtLogin: true });
  assert.deepEqual(loginItemFor({ startAtLogin: false }), { openAtLogin: false });
});

test("directory picker returns one selected folder or null", () => {
  assert.equal(normalizeDirectorySelection({ canceled: true, filePaths: [] }), null);
  assert.equal(
    normalizeDirectorySelection({ canceled: false, filePaths: ["/repo", "/other"] }),
    "/repo",
  );
});
