const http = require("node:http");
const { spawn } = require("node:child_process");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const path = require("node:path");

const defaultHostname = "127.0.0.1";

function launchSecret() {
  return randomBytes(32).toString("base64url");
}

function launchIdentity(nonce) {
  return createHash("sha256")
    .update(`ai-worklog-agent:${String(nonce || "")}`)
    .digest("hex");
}

function safeIdentityEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function getServerConfig(
  { externalUrl, isPackaged, appPath, resourcesPath },
  credentials = {},
) {
  if (externalUrl) {
    return {
      automationAvailable: false,
      mode: "external",
      url: externalUrl,
    };
  }

  const capability = credentials.capability || launchSecret();
  const launchNonce = credentials.launchNonce || launchSecret();
  const port = Number(process.env.WORKLOG_AGENT_PORT || 3000);
  const baseConfig = {
    appPath,
    automationAvailable: true,
    capability,
    hostname: defaultHostname,
    launchNonce,
    mode: "development",
    port,
    url: `http://${defaultHostname}:${port}`,
  };

  if (!isPackaged) {
    return baseConfig;
  }

  const pathApi = resourcesPath.includes("\\") ? path.win32 : path;
  const standalonePath = pathApi.join(resourcesPath, "server");
  return {
    ...baseConfig,
    appPath: standalonePath,
    mode: "standalone",
    serverPath: pathApi.join(standalonePath, "server.js"),
  };
}

async function isAppReady(
  url,
  {
    capability,
    launchNonce,
    fetchImpl = fetch,
  } = {},
) {
  if (!capability || !launchNonce) return false;
  try {
    const response = await fetchImpl(`${url}/api/automation/identity`, {
      headers: { Authorization: `Bearer ${capability}` },
    });
    if (!response.ok) return false;
    const body = await response.json();
    return safeIdentityEqual(body.identity, launchIdentity(launchNonce));
  } catch {
    return false;
  }
}

async function startAppServer(config, dependencies = {}) {
  const isReady = dependencies.isReady || isAppReady;
  const spawnProcess = dependencies.spawnProcess || spawn;

  if (config.mode === "external" || (await isReady(config.url, config))) {
    return {
      automationAvailable: config.automationAvailable,
      capability: config.capability,
      launchNonce: config.launchNonce,
      stop: async () => {},
      url: config.url,
    };
  }

  if (config.mode === "development") {
    const child = spawnProcess("npm", ["run", "dev"], {
      cwd: config.appPath,
      env: {
        ...process.env,
        AUTOMATION_CAPABILITY: config.capability,
        AUTOMATION_LAUNCH_NONCE: config.launchNonce,
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    return {
      automationAvailable: config.automationAvailable,
      capability: config.capability,
      launchNonce: config.launchNonce,
      stop: async () => child.kill(),
      url: config.url,
    };
  }

  if (config.mode === "standalone") {
    if (!dependencies.forkUtility) {
      throw new Error("A utility process launcher is required for the packaged server.");
    }

    const child = dependencies.forkUtility(config.serverPath, [], {
      cwd: config.appPath,
      env: {
        ...process.env,
        AUTOMATION_CAPABILITY: config.capability,
        AUTOMATION_LAUNCH_NONCE: config.launchNonce,
        HOSTNAME: config.hostname,
        PORT: String(config.port),
      },
      serviceName: "AI Worklog Agent Server",
      stdio: "inherit",
    });

    return {
      automationAvailable: config.automationAvailable,
      capability: config.capability,
      launchNonce: config.launchNonce,
      stop: async () => child.kill(),
      url: config.url,
    };
  }

  const next = require("next");
  const nextApp = next({
    dev: false,
    dir: config.appPath,
    hostname: config.hostname,
    port: config.port,
  });
  await nextApp.prepare();

  const handle = nextApp.getRequestHandler();
  const server = http.createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.hostname, resolve);
  });

  return {
    automationAvailable: config.automationAvailable,
    capability: config.capability,
    launchNonce: config.launchNonce,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: config.url,
  };
}

async function isUiReady(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitForAppUrl(url, launch = {}) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = launch.automationAvailable === false
      ? await isUiReady(url)
      : await isAppReady(url, launch);
    if (ready) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`App did not become ready at ${url}`);
}

module.exports = {
  getServerConfig,
  isAppReady,
  startAppServer,
  waitForAppUrl,
};
