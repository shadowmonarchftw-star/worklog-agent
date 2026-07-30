import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  getServerConfig,
  isAppReady,
  startAppServer,
} = require("../electron/app-server.cjs");

test("uses an externally supplied app URL without starting a server", () => {
  assert.deepEqual(
    getServerConfig({
      externalUrl: "http://127.0.0.1:4100",
      isPackaged: true,
      appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\app.asar",
    }),
    {
      automationAvailable: false,
      mode: "external",
      url: "http://127.0.0.1:4100",
    },
  );
});

test("uses the Next development server for an unpackaged app", () => {
  assert.deepEqual(
    getServerConfig(
      {
        isPackaged: false,
        appPath: "/workspace/worklog-agent",
      },
      {
        capability: "capability-1",
        launchNonce: "nonce-1",
      },
    ),
    {
      appPath: "/workspace/worklog-agent",
      automationAvailable: true,
      capability: "capability-1",
      hostname: "127.0.0.1",
      launchNonce: "nonce-1",
      mode: "development",
      port: 3000,
      url: "http://127.0.0.1:3000",
    },
  );
});

test("uses the compiled Next server for an installed app", () => {
  assert.deepEqual(
    getServerConfig(
      {
        isPackaged: true,
        appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\app.asar",
        resourcesPath: "C:\\Program Files\\AI Worklog Agent\\resources",
      },
      {
        capability: "capability-2",
        launchNonce: "nonce-2",
      },
    ),
    {
      appPath: "C:\\Program Files\\AI Worklog Agent\\resources\\server",
      automationAvailable: true,
      capability: "capability-2",
      hostname: "127.0.0.1",
      launchNonce: "nonce-2",
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

test("generates fresh capability and nonce values for every managed launch", () => {
  const input = { isPackaged: false, appPath: "/app" };
  const first = getServerConfig(input);
  const second = getServerConfig(input);

  assert.match(first.capability, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.launchNonce, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.capability, first.launchNonce);
  assert.notEqual(first.capability, second.capability);
  assert.notEqual(first.launchNonce, second.launchNonce);
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
      automationAvailable: true,
      capability: "packaged-capability",
      hostname: "127.0.0.1",
      launchNonce: "packaged-nonce",
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
  assert.equal(
    calls[0][2].env.AUTOMATION_CAPABILITY,
    "packaged-capability",
  );
  assert.equal(calls[0][2].env.AUTOMATION_LAUNCH_NONCE, "packaged-nonce");
  assert.equal(calls[0][2].serviceName, "AI Worklog Agent Server");
  assert.equal(calls[0][2].stdio, "inherit");
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined);

  await server.stop();
  assert.equal(stopped, true);
});

test("passes launch credentials to an Electron-managed development server", async () => {
  const calls = [];
  const child = { kill() {} };
  await startAppServer(
    {
      appPath: "/workspace/worklog-agent",
      automationAvailable: true,
      capability: "dev-capability",
      hostname: "127.0.0.1",
      launchNonce: "dev-nonce",
      mode: "development",
      port: 3000,
      url: "http://127.0.0.1:3000",
    },
    {
      isReady: async () => false,
      spawnProcess: (...args) => {
        calls.push(args);
        return child;
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["npm", ["run", "dev"]]);
  assert.equal(calls[0][2].env.AUTOMATION_CAPABILITY, "dev-capability");
  assert.equal(calls[0][2].env.AUTOMATION_LAUNCH_NONCE, "dev-nonce");
});

test("external mode is UI-only and does not inspect or forward credentials", async () => {
  let started = false;
  const config = getServerConfig(
    {
      externalUrl: "https://dev.example.test",
      isPackaged: false,
      appPath: "/workspace/worklog-agent",
    },
    {
      capability: "must-not-appear",
      launchNonce: "must-not-appear",
    },
  );
  const server = await startAppServer(config, {
    spawnProcess: () => {
      started = true;
    },
  });

  assert.deepEqual(config, {
    automationAvailable: false,
    mode: "external",
    url: "https://dev.example.test",
  });
  assert.equal(started, false);
  assert.equal(server.automationAvailable, false);
});

test("readiness adopts only the matching token-protected launch identity", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      identity:
        "10aeff3f2ef6f513d3704ebc3bcca238ad7f6f3b03659349aa1df71d811ed6d9",
    });
  };

  assert.equal(await isAppReady("http://127.0.0.1:3000", {
    capability: "ready-capability",
    launchNonce: "ready-nonce",
    fetchImpl,
  }), true);
  assert.equal(requests[0].url, "http://127.0.0.1:3000/api/automation/identity");
  assert.equal(
    requests[0].options.headers.Authorization,
    "Bearer ready-capability",
  );

  assert.equal(await isAppReady("http://127.0.0.1:3000", {
    capability: "ready-capability",
    launchNonce: "different-nonce",
    fetchImpl,
  }), false);
});
