const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  savePdf: (buffer) => ipcRenderer.invoke("save-pdf", buffer),
  openCsv: () => ipcRenderer.invoke("open-csv"),
  openGuide: () => ipcRenderer.invoke("open-guide"),
  openExamples: () => ipcRenderer.invoke("open-examples"),
  downloadExample: (name) => ipcRenderer.invoke("download-example", name),
  listExamples: () => ipcRenderer.invoke("list-examples"),
  openPromptGuide: () => ipcRenderer.invoke("open-prompt-guide"),

  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateEvent: (handler) => {
    const channels = [
      "update-available",
      "update-not-available",
      "update-progress",
      "update-downloaded",
      "update-error",
    ];
    const subs = channels.map((ch) => {
      const fn = (_e, payload) => handler(ch, payload);
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    });
    return () => subs.forEach((u) => u());
  },
});
