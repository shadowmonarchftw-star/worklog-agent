const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worklogDesktop", {
  getAutomationStatus: () => ipcRenderer.invoke("automation:status"),
  runAutomation: () => ipcRenderer.invoke("automation:run"),
  saveAutomationSettings: (settings) =>
    ipcRenderer.invoke("automation:save-settings", settings),
  chooseLocalRepository: () => ipcRenderer.invoke("local-git:choose-repository"),
  inspectLocalRepository: (repositoryPath) =>
    ipcRenderer.invoke("local-git:inspect-repository", repositoryPath),
  onUpdateAvailable: (callback) => ipcRenderer.on("update:available", (_event, info) => callback(info)),
  onUpdateProgress: (callback) => ipcRenderer.on("update:progress", (_event, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update:downloaded", (_event, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on("update:error", (_event, info) => callback(info)),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
});
