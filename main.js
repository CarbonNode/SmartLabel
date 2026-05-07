const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

// Single-instance lock — second launch focuses the existing window instead of opening a new one
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Windows taskbar grouping / process identity
if (process.platform === "win32") {
  app.setAppUserModelId("com.bestway.smartlabel");
}
app.setName("SmartLabel");

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

function getIconPath() {
  const names = process.platform === "win32"
    ? ["icon.ico", "icon.png"]
    : ["icon.png"];
  const dirs = app.isPackaged
    ? [path.join(process.resourcesPath, "build"), path.join(__dirname, "build")]
    : [path.join(__dirname, "build")];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

function getGuidePath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "docs", "guide.html"),
        path.join(__dirname, "docs", "guide.html"),
      ]
    : [path.join(__dirname, "docs", "guide.html")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getExamplesDir() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "assets", "examples"),
        path.join(__dirname, "assets", "examples"),
      ]
    : [path.join(__dirname, "assets", "examples")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getExamplesHtmlPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "docs", "examples.html"),
        path.join(__dirname, "docs", "examples.html"),
      ]
    : [path.join(__dirname, "docs", "examples.html")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getPromptGuidePath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "docs", "prompt-guide.html"),
        path.join(__dirname, "docs", "prompt-guide.html"),
      ]
    : [path.join(__dirname, "docs", "prompt-guide.html")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const EXAMPLES = [
  {
    file: "k2_locations_with_arrows.csv",
    name: "K2 Aisles — Full Set",
    description: "All locations across K2 aisles 02–04 (and friends), every level 1/2/3 with mixed UP/DOWN arrows. ~1,656 labels — the bulk warehouse use case.",
  },
  {
    file: "k2_ceiling_labels.csv",
    name: "K2 Ceiling Labels (EW)",
    description: "End-of-row / ceiling location labels using the K2-EW-XXX format. No arrows. ~175 labels.",
  },
  {
    file: "smartlabel_mixed_request.csv",
    name: "Mixed Request Demo",
    description: "Demonstrates EVEN-only ranges, multi-aisle ranges, single locations, and mixed levels in one file. 271 labels.",
  },
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#0a0e1a",
    icon: getIconPath(),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0e1a",
      symbolColor: "#8a96bd",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "SmartLabel",
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ---------- Auto-update (electron-updater + GitHub Releases) ----------

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

autoUpdater.on("update-available", (info) => {
  sendUpdate("update-available", { version: info.version, releaseNotes: info.releaseNotes });
});

autoUpdater.on("update-not-available", () => {
  sendUpdate("update-not-available");
});

autoUpdater.on("download-progress", (progress) => {
  sendUpdate("update-progress", {
    percent: Math.round(progress.percent),
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  });
});

autoUpdater.on("update-downloaded", (info) => {
  sendUpdate("update-downloaded", { version: info.version });
});

autoUpdater.on("error", (err) => {
  sendUpdate("update-error", { message: String(err && err.message ? err.message : err) });
});

ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) return { skipped: true, reason: "dev mode" };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: r && r.updateInfo ? { version: r.updateInfo.version } : null };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle("update:download", async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle("update:install", () => {
  // Quit, run installer, relaunch
  autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startBackend();
  setTimeout(createWindow, 1500);

  // Background update check + periodic recheck (only in packaged builds)
  if (app.isPackaged) {
    const safeCheck = () =>
      autoUpdater.checkForUpdates().catch((e) => {
        console.log("[updater] check failed:", e && e.message ? e.message : e);
      });
    setTimeout(safeCheck, 4000);
    setInterval(safeCheck, 15 * 60 * 1000); // re-check every 15 minutes
  }

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

let guideWindow = null;
let examplesWindow = null;
let promptGuideWindow = null;

ipcMain.handle("open-prompt-guide", async () => {
  const htmlPath = getPromptGuidePath();
  if (!htmlPath) return false;

  if (promptGuideWindow && !promptGuideWindow.isDestroyed()) {
    promptGuideWindow.focus();
    return true;
  }

  promptGuideWindow = new BrowserWindow({
    width: 820,
    height: 760,
    parent: mainWindow,
    modal: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    backgroundColor: "#0a0e1a",
    icon: getIconPath(),
    autoHideMenuBar: true,
    title: "AI Prompt Guide — SmartLabel",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  promptGuideWindow.setMenuBarVisibility(false);
  promptGuideWindow.loadFile(htmlPath);
  promptGuideWindow.on("closed", () => { promptGuideWindow = null; });
  return true;
});

ipcMain.handle("list-examples", () => EXAMPLES);

ipcMain.handle("open-examples", async () => {
  const htmlPath = getExamplesHtmlPath();
  if (!htmlPath) return false;

  if (examplesWindow && !examplesWindow.isDestroyed()) {
    examplesWindow.focus();
    return true;
  }

  examplesWindow = new BrowserWindow({
    width: 720,
    height: 640,
    parent: mainWindow,
    modal: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    backgroundColor: "#0a0e1a",
    icon: getIconPath(),
    autoHideMenuBar: true,
    title: "Example CSVs — SmartLabel",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  examplesWindow.setMenuBarVisibility(false);
  examplesWindow.loadFile(htmlPath);
  examplesWindow.on("closed", () => { examplesWindow = null; });
  return true;
});

ipcMain.handle("download-example", async (event, fileName) => {
  const dir = getExamplesDir();
  if (!dir) return null;
  const meta = EXAMPLES.find((e) => e.file === fileName);
  if (!meta) return null;
  const sourcePath = path.join(dir, fileName);
  if (!fs.existsSync(sourcePath)) return null;

  const targetWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const { filePath } = await dialog.showSaveDialog(targetWin, {
    defaultPath: fileName,
    filters: [{ name: "CSV Files", extensions: ["csv"] }],
  });
  if (!filePath) return null;
  fs.copyFileSync(sourcePath, filePath);
  shell.showItemInFolder(filePath);
  return filePath;
});

// Open the user guide in an in-app popout window
ipcMain.handle("open-guide", async () => {
  const guidePath = getGuidePath();
  if (!guidePath) return false;

  if (guideWindow && !guideWindow.isDestroyed()) {
    guideWindow.focus();
    return true;
  }

  guideWindow = new BrowserWindow({
    width: 820,
    height: 720,
    parent: mainWindow,
    modal: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    backgroundColor: "#0a0e1a",
    icon: getIconPath(),
    autoHideMenuBar: true,
    title: "How to Use — SmartLabel",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  guideWindow.setMenuBarVisibility(false);
  guideWindow.loadFile(guidePath);
  guideWindow.on("closed", () => { guideWindow = null; });
  return true;
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
