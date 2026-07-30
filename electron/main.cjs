const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { registerExternalLinkHandler } = require("./external-links.cjs");

const appUrl = process.env.ELECTRON_START_URL || "http://127.0.0.1:3000";
let nextProcess;

async function isAppUrlReady() {
  try {
    const response = await fetch(appUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function startNextDevServer() {
  if (process.env.ELECTRON_START_URL) {
    return;
  }

  if (await isAppUrlReady()) {
    return;
  }

  nextProcess = spawn("npm", ["run", "dev"], {
    cwd: path.join(__dirname, ".."),
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

async function waitForAppUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isAppUrlReady()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`App did not become ready at ${appUrl}`);
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 720,
    title: "AI Worklog Agent",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerExternalLinkHandler(window, (url) => shell.openExternal(url));

  await waitForAppUrl();
  await window.loadURL(appUrl);
}

app.whenReady().then(async () => {
  await startNextDevServer();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (nextProcess) {
    nextProcess.kill();
  }
});
