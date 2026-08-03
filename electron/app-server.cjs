const http = require("node:http");
const { spawn } = require("node:child_process");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const net = require("node:net");
const path = require("node:path");

const defaultHostname = "127.0.0.1";
const defaultReadinessTimeoutMs = 1_000;

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

async function availablePort(hostname, preferredPort) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code !== "EADDRINUSE") {
        resolve(preferredPort);
        return;
      }
      probe.listen(0, hostname);
    });
    probe.once("listening", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.listen(preferredPort, hostname);
  });
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    controller.signal,
  ]);
  const timer = setTimeout(() => {
    controller.abort(new Error("Readiness request timed out."));
  }, timeoutMs);
  const aborted = new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...options, signal }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
  }
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
    readinessTimeoutMs = defaultReadinessTimeoutMs,
  } = {},
) {
  if (!capability || !launchNonce) return false;
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `${url}/api/automation/identity`,
      { headers: { Authorization: `Bearer ${capability}` } },
      readinessTimeoutMs,
    );
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

  const port = await availablePort(config.hostname, config.port);
  const runtimeConfig = {
    ...config,
    port,
    url: `http://${config.hostname}:${port}`,
  };

  if (runtimeConfig.mode === "development") {
    const child = spawnProcess("npm", ["run", "dev"], {
      cwd: runtimeConfig.appPath,
      env: {
        ...process.env,
        AUTOMATION_CAPABILITY: runtimeConfig.capability,
        AUTOMATION_LAUNCH_NONCE: runtimeConfig.launchNonce,
        WORKLOG_AGENT_PORT: String(runtimeConfig.port),
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    return {
      automationAvailable: runtimeConfig.automationAvailable,
      capability: runtimeConfig.capability,
      launchNonce: runtimeConfig.launchNonce,
      stop: async () => child.kill(),
      url: runtimeConfig.url,
    };
  }

  if (config.mode === "standalone") {
    if (!dependencies.forkUtility) {
      throw new Error("A utility process launcher is required for the packaged server.");
    }

    const child = dependencies.forkUtility(runtimeConfig.serverPath, [], {
      cwd: runtimeConfig.appPath,
      env: {
        ...process.env,
        AUTOMATION_CAPABILITY: runtimeConfig.capability,
        AUTOMATION_LAUNCH_NONCE: runtimeConfig.launchNonce,
        HOSTNAME: runtimeConfig.hostname,
        PORT: String(runtimeConfig.port),
      },
      serviceName: "AI Worklog Agent Server",
      stdio: "inherit",
    });

    return {
      automationAvailable: runtimeConfig.automationAvailable,
      capability: runtimeConfig.capability,
      launchNonce: runtimeConfig.launchNonce,
      stop: async () => child.kill(),
      url: runtimeConfig.url,
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

async function isUiReady(
  url,
  {
    fetchImpl = fetch,
    readinessTimeoutMs = defaultReadinessTimeoutMs,
  } = {},
) {
  try {
    return (await fetchWithTimeout(
      fetchImpl,
      url,
      {},
      readinessTimeoutMs,
    )).ok;
  } catch {
    return false;
  }
}

async function waitForAppUrl(url, launch = {}) {
  const attempts = launch.attempts ?? 60;
  const retryDelayMs = launch.retryDelayMs ?? 500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ready = launch.automationAvailable === false
      ? await isUiReady(url, launch)
      : await isAppReady(url, launch);
    if (ready) {
      return;
    }

    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`App did not become ready at ${url}`);
}

module.exports = {
  getServerConfig,
  isAppReady,
  startAppServer,
  waitForAppUrl,
};
