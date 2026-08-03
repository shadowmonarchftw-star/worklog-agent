const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
  utilityProcess,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const { getServerConfig, startAppServer, waitForAppUrl } = require("./app-server.cjs");
const { registerExternalLinkHandler } = require("./external-links.cjs");
const { createScheduler } = require("./scheduler.cjs");
const { createShutdownHandler } = require("./shutdown.cjs");
const {
  loginItemFor,
  normalizeDirectorySelection,
  shouldKeepAlive,
  shouldStartHidden,
} = require("./lifecycle.cjs");

if (process.env.WORKLOG_AGENT_SMOKE_USER_DATA) {
  app.setPath("userData", process.env.WORKLOG_AGENT_SMOKE_USER_DATA);
}

let appServer;
let appUrl;
let scheduler;
let mainWindow;
let tray;
let automationSettings = {};
let isQuitting = false;

function credentialKey() {
  const keyPath = path.join(app.getPath("userData"), "credential-key");
  try {
    const stored = fs.readFileSync(keyPath, "utf8").trim();
    if (stored && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    }
    if (stored) return stored;
  } catch {}
  const next = require("node:crypto").randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const stored = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(next).toString("base64")
    : next;
  fs.writeFileSync(keyPath, stored, { mode: 0o600 });
  return next;
}

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
    loadSettings: async ({ signal } = {}) =>
      (await automationRequest("settings", { signal })).settings,
    loadStatus: async ({ signal } = {}) =>
      (await automationRequest("settings", { signal })).status,
    recover: ({ signal } = {}) => automationRequest("recover", {
      method: "POST",
      body: "{}",
      signal,
    }),
    run: (input, { signal } = {}) => automationRequest("run", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
    notify: (payload) => new Notification(payload).show(),
  });
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 720,
    title: "AI Worklog Agent",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = window;
  window.on("close", (event) => {
    if (!isQuitting && shouldKeepAlive(automationSettings)) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  registerExternalLinkHandler(window, (url) => shell.openExternal(url));

  await window.loadURL(appUrl);
  return window;
}

function trayIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "tray-icon.png")
    : path.join(__dirname, "..", "build", "icon.png");
  return nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
}

function ensureTray() {
  if (tray || !shouldKeepAlive(automationSettings)) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("AI Worklog Agent");
  tray.on("double-click", () => void createWindow());
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: automationSettings.enabled ? "Automation enabled" : "Automation paused", enabled: false },
    { type: "separator" },
    { label: "Open AI Worklog Agent", click: () => void createWindow() },
    { label: "Run worklog now", click: () => void scheduler?.runNow() },
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
  ]));
}

async function reconcileAutomationSettings(nextSettings) {
  automationSettings = nextSettings || {};
  app.setLoginItemSettings(loginItemFor(automationSettings));
  if (shouldKeepAlive(automationSettings)) ensureTray();
  else if (tray) {
    tray.destroy();
    tray = null;
  }
  updateTrayMenu();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
app.on("second-instance", () => {
  void createWindow();
});

app.whenReady().then(async () => {
  const serverConfig = getServerConfig({
    appPath: app.getAppPath(),
    externalUrl: process.env.ELECTRON_START_URL,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  process.env.WORKLOG_AGENT_CREDENTIAL_KEY ||= credentialKey();
  appServer = await startAppServer(serverConfig, {
    forkUtility: (modulePath, args, options) =>
      utilityProcess.fork(modulePath, args, options),
  });
  appUrl = appServer.url;
  await waitForAppUrl(appUrl, appServer);
  if (appServer.automationAvailable) {
    scheduler = createAutomationScheduler();
    await scheduler.start();
    const data = await automationRequest("settings");
    await reconcileAutomationSettings(data.settings);
    powerMonitor.on("resume", () => {
      void scheduler.resume();
    });
  }
  const loginLaunch = app.getLoginItemSettings().wasOpenedAtLogin;
  if (!shouldStartHidden({ loginLaunch, settings: automationSettings })) {
    await createWindow();
  } else {
    ensureTray();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
}

ipcMain.handle("automation:status", async () => {
  const data = await automationRequest("settings");
  const schedulerStatus = scheduler?.status() || { active: false };
  return {
    ...data,
    status: {
      ...(data.status || {}),
      scheduler: schedulerStatus,
    },
  };
});
ipcMain.handle("automation:run", async () => scheduler?.runNow() || {
  status: "unavailable",
  error: "Automation is unavailable in this mode.",
});
ipcMain.handle("automation:save-settings", async (_event, patch) => {
  const data = await automationRequest("settings", {
    method: "POST",
    body: JSON.stringify(patch),
    headers: { Origin: appUrl },
  });
  await reconcileAutomationSettings(data.settings);
  // Re-evaluate immediately after a schedule change so a run is not delayed
  // until the next minute tick, especially when the time was just reached.
  await scheduler?.resume();
  return data;
});
ipcMain.handle("local-git:choose-repository", async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    properties: ["openDirectory"],
    title: "Choose a local Git repository",
  });
  return normalizeDirectorySelection(result);
});
ipcMain.handle("local-git:inspect-repository", async (_event, repositoryPath) => {
  if (typeof repositoryPath !== "string" || !repositoryPath.trim()) {
    throw new Error("Choose a repository folder.");
  }
  const data = await automationRequest("inspect-repository", {
    method: "POST",
    body: JSON.stringify({ path: repositoryPath }),
    headers: { Origin: appUrl },
  });
  return data.repository;
});
function updateFailureReason(error) {
  const message = String(error?.message || error || "").replace(/\s+/g, " ").trim();
  if (/status 40[34]/.test(message)) {
    return "The update file is missing from the release. Download the new version manually.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return "Could not reach the update server. Check your connection and try again.";
  }
  return message.slice(0, 200) || "The update could not be downloaded.";
}

// autoUpdater is only wired up when packaged, so answer plainly in dev instead of
// rejecting into the renderer.
ipcMain.handle("update:download", async () => {
  if (!app.isPackaged) return { ok: false, reason: "unavailable-in-development" };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    // A rejection here reaches the renderer as an unhandled promise, so the
    // button would appear to do nothing at all. Report it instead.
    const reason = updateFailureReason(error);
    mainWindow?.webContents.send("update:error", { message: reason });
    return { ok: false, reason };
  }
});
ipcMain.handle("update:install", () => {
  if (!app.isPackaged) return { ok: false, reason: "unavailable-in-development" };
  autoUpdater.quitAndInstall();
  return { ok: true };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !shouldKeepAlive(automationSettings)) {
    app.quit();
  }
});

if (app.isPackaged) {
  autoUpdater.autoDownload = false;
  // An "error" event with no listener is an uncaught exception on an EventEmitter,
  // which would take the whole app down on a routine update-check network failure.
  // Report it to the window instead of discarding it, so a failed update is
  // visible rather than looking like a button that does nothing.
  autoUpdater.on("error", (error) => {
    mainWindow?.webContents.send("update:error", {
      message: updateFailureReason(error),
    });
  });
  autoUpdater.on("update-available", (info) => mainWindow?.webContents.send("update:available", info));
  autoUpdater.on("download-progress", (info) => mainWindow?.webContents.send("update:progress", { percent: Math.round(info.percent) }));
  autoUpdater.on("update-downloaded", (info) => mainWindow?.webContents.send("update:downloaded", info));
  app.whenReady().then(() => void autoUpdater.checkForUpdates().catch(() => {}));
}

const shutdown = createShutdownHandler({
  getScheduler: () => scheduler,
  getAppServer: () => appServer,
  exit: (code) => {
    tray?.destroy();
    tray = null;
    app.exit(code);
  },
});

app.on("before-quit", (event) => {
  isQuitting = true;
  void shutdown(event);
});
