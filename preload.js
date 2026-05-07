const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  savePdf: (buffer) => ipcRenderer.invoke("save-pdf", buffer),
  openCsv: () => ipcRenderer.invoke("open-csv"),
  openGuide: () => ipcRenderer.invoke("open-guide"),
  openExamples: () => ipcRenderer.invoke("open-examples"),
  downloadExample: (name) => ipcRenderer.invoke("download-example", name),
  listExamples: () => ipcRenderer.invoke("list-examples"),
  openPromptGuide: () => ipcRenderer.invoke("open-prompt-guide"),
});
