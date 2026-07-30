import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getServerConfig } = require("../electron/app-server.cjs");

test("uses an externally supplied app URL without starting a server", () => {
  assert.deepEqual(
    getServerConfig({
      externalUrl: "http://127.0.0.1:4100",
      isPackaged: true,
      appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\app.asar",
    }),
    {
      mode: "external",
      url: "http://127.0.0.1:4100",
    },
  );
});

test("uses the Next development server for an unpackaged app", () => {
  assert.deepEqual(
    getServerConfig({
      isPackaged: false,
      appPath: "/workspace/worklog-agent",
    }),
    {
      appPath: "/workspace/worklog-agent",
      hostname: "127.0.0.1",
      mode: "development",
      port: 3000,
      url: "http://127.0.0.1:3000",
    },
  );
});

test("uses the compiled Next server for an installed app", () => {
  assert.deepEqual(
    getServerConfig({
      isPackaged: true,
      appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\app.asar",
    }),
    {
      appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\app.asar",
      hostname: "127.0.0.1",
      mode: "production",
      port: 3000,
      url: "http://127.0.0.1:3000",
    },
  );
});
