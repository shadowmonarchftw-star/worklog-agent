const http = require("node:http");
const { spawn } = require("node:child_process");

const defaultHostname = "127.0.0.1";
const defaultPort = 3000;

function getServerConfig({ externalUrl, isPackaged, appPath }) {
  if (externalUrl) {
    return {
      mode: "external",
      url: externalUrl,
    };
  }

  return {
    appPath,
    hostname: defaultHostname,
    mode: isPackaged ? "production" : "development",
    port: defaultPort,
    url: `http://${defaultHostname}:${defaultPort}`,
  };
}

async function isAppReady(url) {
  try {
    const response = await fetch(`${url}/api/google/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startAppServer(config) {
  if (config.mode === "external" || (await isAppReady(config.url))) {
    return {
      stop: async () => {},
      url: config.url,
    };
  }

  if (config.mode === "development") {
    const child = spawn("npm", ["run", "dev"], {
      cwd: config.appPath,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    return {
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
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: config.url,
  };
}

async function waitForAppUrl(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isAppReady(url)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`App did not become ready at ${url}`);
}

module.exports = {
  getServerConfig,
  startAppServer,
  waitForAppUrl,
};
