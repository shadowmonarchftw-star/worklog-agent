const {
  app,
  BrowserWindow,
  Notification,
  powerMonitor,
  shell,
  utilityProcess,
} = require("electron");
const { getServerConfig, startAppServer, waitForAppUrl } = require("./app-server.cjs");
const { registerExternalLinkHandler } = require("./external-links.cjs");
const { createScheduler } = require("./scheduler.cjs");

let appServer;
let appUrl;
let scheduler;

async function automationRequest(path, options = {}) {
  const response = await fetch(`${appUrl}/api/automation/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${appServer.capability}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await response.json();
  if (body.result) return body.result;
  if (!response.ok) throw new Error(body.error || "Automation failed.");
  return body;
}

function createAutomationScheduler() {
  return createScheduler({
    loadSettings: async () =>
      (await automationRequest("settings")).settings,
    loadStatus: async () =>
      (await automationRequest("settings")).status,
    recover: () => automationRequest("recover", {
      method: "POST",
      body: "{}",
    }),
    run: (input) => automationRequest("run", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    notify: (payload) => new Notification(payload).show(),
  });
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

  await window.loadURL(appUrl);
}

app.whenReady().then(async () => {
  const serverConfig = getServerConfig({
    appPath: app.getAppPath(),
    externalUrl: process.env.ELECTRON_START_URL,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  appServer = await startAppServer(serverConfig, {
    forkUtility: (modulePath, args, options) =>
      utilityProcess.fork(modulePath, args, options),
  });
  appUrl = appServer.url;
  await waitForAppUrl(appUrl, appServer);
  if (appServer.automationAvailable) {
    scheduler = createAutomationScheduler();
    await scheduler.start();
    powerMonitor.on("resume", () => {
      void scheduler.resume();
    });
  }
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

app.on("before-quit", async () => {
  scheduler?.stop();
  if (appServer) {
    await appServer.stop();
  }
});
