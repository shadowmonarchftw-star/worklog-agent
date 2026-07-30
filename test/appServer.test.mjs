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
      resourcesPath: "C:\\Program Files\\AI Worklog Agent\\resources",
    }),
    {
      appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\server",
      hostname: "127.0.0.1",
      mode: "standalone",
      port: 3000,
      serverPath: "C:\\Program Files\\AI Worklog Agent\\resources\\server\\server.js",
      url: "http://127.0.0.1:3000",
    },
  );
});

test("uses an isolated port when configured for packaged smoke tests", async () => {
  const originalPort = process.env.WORKLOG_AGENT_PORT;
  process.env.WORKLOG_AGENT_PORT = "31888";

  const config = getServerConfig({
    isPackaged: false,
    appPath: "/app",
  });

  assert.equal(config.port, 31888);
  assert.equal(config.url, "http://127.0.0.1:31888");
  if (originalPort === undefined) delete process.env.WORKLOG_AGENT_PORT;
  else process.env.WORKLOG_AGENT_PORT = originalPort;
});
