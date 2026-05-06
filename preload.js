const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  savePdf: (buffer) => ipcRenderer.invoke("save-pdf", buffer),
  openCsv: () => ipcRenderer.invoke("open-csv"),
});
