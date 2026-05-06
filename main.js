const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

let mainWindow;
let pythonProcess;
const BACKEND_PORT = 5555;

function startBackend() {
  let cmd, args;
  if (app.isPackaged) {
    // Packaged: use bundled exe
    cmd = path.join(process.resourcesPath, "backend", "label-backend.exe");
    args = [String(BACKEND_PORT)];
  } else {
    // Dev mode: always use Python
    cmd = "python";
    args = [path.join(__dirname, "backend", "server.py"), String(BACKEND_PORT)];
  }
  pythonProcess = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  pythonProcess.stdout.on("data", (data) => {
    console.log(`[backend] ${data}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    console.log(`[backend] ${data}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`Backend exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Best Way Easy Label Generator",
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  startBackend();
  setTimeout(createWindow, 1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

// Handle CSV file open dialog
ipcMain.handle("open-csv", async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: "CSV Files", extensions: ["csv", "txt"] }],
    properties: ["openFile"],
  });
  if (filePaths && filePaths.length > 0) {
    return fs.readFileSync(filePaths[0], "utf-8");
  }
  return null;
});

// Handle save dialog from renderer
ipcMain.handle("save-pdf", async (event, pdfBuffer) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: "warehouse_labels.pdf",
    filters: [{ name: "PDF Files", extensions: ["pdf"] }],
  });

  if (filePath) {
    fs.writeFileSync(filePath, Buffer.from(pdfBuffer));
    shell.openPath(filePath);
    return filePath;
  }
  return null;
});
