const { app, BrowserWindow, shell, utilityProcess } = require("electron");
const { getServerConfig, startAppServer, waitForAppUrl } = require("./app-server.cjs");
const { registerExternalLinkHandler } = require("./external-links.cjs");

let appServer;
let appUrl;

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

  await waitForAppUrl(appUrl, appServer);
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
  if (appServer) {
    await appServer.stop();
  }
});
