const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worklogDesktop", {
  getAutomationStatus: () => ipcRenderer.invoke("automation:status"),
  runAutomation: () => ipcRenderer.invoke("automation:run"),
  saveAutomationSettings: (settings) =>
    ipcRenderer.invoke("automation:save-settings", settings),
});
