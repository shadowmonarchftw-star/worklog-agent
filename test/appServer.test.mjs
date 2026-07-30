import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getServerConfig, startAppServer } = require("../electron/app-server.cjs");

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

test("runs the packaged server as a background utility process", async () => {
  const calls = [];
  let stopped = false;
  const utilityProcess = {
    kill() {
      stopped = true;
    },
  };

  const server = await startAppServer(
    {
      appPath: "/Applications/AI Worklog Agent.app/Contents/Resources/server",
      hostname: "127.0.0.1",
      mode: "standalone",
      port: 31888,
      serverPath:
        "/Applications/AI Worklog Agent.app/Contents/Resources/server/server.js",
      url: "http://127.0.0.1:31888",
    },
    {
      isReady: async () => false,
      forkUtility: (...args) => {
        calls.push(args);
        return utilityProcess;
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][0],
    "/Applications/AI Worklog Agent.app/Contents/Resources/server/server.js",
  );
  assert.deepEqual(calls[0][1], []);
  assert.equal(
    calls[0][2].cwd,
    "/Applications/AI Worklog Agent.app/Contents/Resources/server",
  );
  assert.equal(calls[0][2].env.HOSTNAME, "127.0.0.1");
  assert.equal(calls[0][2].env.PORT, "31888");
  assert.equal(calls[0][2].serviceName, "AI Worklog Agent Server");
  assert.equal(calls[0][2].stdio, "inherit");
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined);

  await server.stop();
  assert.equal(stopped, true);
});
