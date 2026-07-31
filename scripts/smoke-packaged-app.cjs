const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const executablePath = process.argv[2];
if (!executablePath) {
  throw new Error("Pass the packaged app executable path.");
}

const port = 31000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const userDataDir = mkdtempSync(path.join(tmpdir(), "worklog-agent-smoke-"));
const child = spawn(executablePath, [
  "--enable-logging=stderr",
  `--user-data-dir=${userDataDir}`,
], {
  env: {
    ...process.env,
    WORKLOG_AGENT_PORT: String(port),
    WORKLOG_AGENT_SMOKE_USER_DATA: userDataDir,
  },
  stdio: "inherit",
});

async function waitFor(url) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged app exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Packaged app did not become ready at ${url}`);
}

async function stop() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "inherit",
    });
    return;
  }
  child.kill("SIGTERM");
}

async function main() {
  const root = await waitFor(`${baseUrl}/`);
  const html = await root.text();
  if (!html.includes("AI Worklog Agent")) {
    throw new Error("Local server did not return the packaged Worklog Agent.");
  }
  await waitFor(`${baseUrl}/api/google/status`);

  const assets = [
    ...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g),
  ].map((match) => match[1]);
  if (!assets.length) {
    throw new Error("No packaged JavaScript or CSS assets were found.");
  }

  for (const asset of new Set(assets)) {
    await waitFor(`${baseUrl}${asset}`);
  }
}

main()
  .then(stop)
  .catch(async (error) => {
    console.error(error);
    await stop();
    process.exitCode = 1;
  });
