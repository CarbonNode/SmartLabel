# SmartLabel

Electron + Python desktop app that generates warehouse location labels (12×4" PDF, one per page, with arrows + barcode) for Best Way Distribution.

## Stack
- **UI**: Electron (renderer = vanilla JS, no framework)
- **Backend**: Flask + ReportLab + python-barcode, packaged with PyInstaller into `label-backend.exe`
- **Installer**: NSIS via electron-builder
- **Distribution**: GitHub Releases on `CarbonNode/SmartLabel`

## Layout
- `main.js` — Electron main: spawns the Python backend, single-instance lock, IPC handlers (open-csv, save-pdf, open-guide, open-examples, open-prompt-guide, download-example), title-bar overlay
- `preload.js` — exposes `window.api`
- `renderer/` — the UI
  - `index.html` / `style.css`
  - `renderer.js` — bulk paste DSL parser (`analyzeBulkText`, `expandRange`, etc.), pill rendering, manual entry, CSV import, generate flow + overlay animation
- `backend/` — Python backend
  - `server.py` — Flask routes
  - `generator.py` — PDF rendering with ReportLab + barcode image generation
  - `label-backend.spec` — PyInstaller spec; uses `collect_all` for runtime deps so all data files / hidden imports are bundled
- `docs/` — in-app popout HTML (guide, examples, prompt-guide). Bundled via `extraResources`.
- `assets/examples/` — sample CSVs shipped with the app
- `build/` — `icon.png` (1024×1024) and generated `icon.ico` (multi-res)

## Important: two Python installs on this machine
The Microsoft Store Python and the Programs Python are both on PATH. `pyinstaller` is in the **Programs Python** at `C:\Users\rober\AppData\Local\Programs\Python\Python313`, but `pip` resolves to the Microsoft Store one. **Always install Python deps with the explicit path** so they go where pyinstaller can see them:

```
C:\Users\rober\AppData\Local\Programs\Python\Python313\python.exe -m pip install -r backend\requirements.txt
```

Symptom of getting this wrong: PyInstaller builds an EXE that crashes on launch with `ModuleNotFoundError: No module named 'barcode'`.

## Building

### Dev (no installer)
```
npm start
```
Spawns the Python backend (`python backend/server.py 5555`) and opens the Electron window. Renderer hot-reloads if you restart Electron.

### Backend EXE
```
npm run build:backend
```
Outputs `backend/dist/label-backend.exe` (~35 MB). Required before any installer build.

### Installer (NSIS)
```
npm run dist
```
Outputs `dist/SmartLabel-Setup-<version>.exe`. Does NOT publish to GitHub.

## Releasing to GitHub (this is the share-with-Best-Way flow)

**One-time setup:**
1. Generate a GitHub Personal Access Token with `repo` scope at https://github.com/settings/tokens
2. Set it as a persistent env var:
   ```
   setx GH_TOKEN "ghp_yourtokenhere"
   ```
   Open a fresh terminal so the env var takes effect.

**Each release (always increments version):**
```
npm run build:backend     # rebuild backend exe if backend/* changed
npm run release:patch     # bumps 2.0.0 -> 2.0.1, builds installer, uploads to GitHub Releases as a DRAFT
```

Use `release:minor` or `release:major` for bigger jumps. The script:
1. Bumps the version in `package.json`
2. Creates a git commit `chore: release v<version>` and a matching tag
3. Runs electron-builder, which builds the installer and uploads it to a GitHub draft release named after the version

**After running:**
1. `git push --follow-tags` — push the version commit and tag
2. Go to https://github.com/CarbonNode/SmartLabel/releases — there will be a draft release for the new version
3. Edit the draft, add release notes, click **Publish release**
4. Send the release URL to Best Way — they download `SmartLabel-Setup-<version>.exe` and run it

**Always increment the version** so the installer filename and EXE metadata differ from prior builds. Best Way can identify which version they're running by right-clicking `SmartLabel.exe` → Properties → Details.

## Auto-update

`electron-updater` checks GitHub Releases on app startup (4-second delay so backend can come up first). Only runs in packaged builds — `app.isPackaged` guard, dev mode is silent.

Flow:
1. Open app → background check fetches `latest.yml` from latest GitHub release
2. If newer version found → bottom-right toast with **Update** / **Later**
3. **Update** → `autoUpdater.downloadUpdate()` runs, toast shows progress %
4. Download finishes → toast switches to **Restart** state
5. **Restart** → `quitAndInstall(false, true)` runs the NSIS installer and relaunches

The toast is `#update-toast` in `index.html` with three sub-states (available / downloading / ready). State switching lives in `renderer.js#setUpdateState`. Errors get logged to console but no toast (silent fail — don't pester the user if GitHub is unreachable).

Note: auto-update only works going *forward* from the first release that contains the auto-updater code (v2.0.2+). Older installs (v2.0.1) won't auto-update — those users need to download v2.0.2 manually once.

## Bulk Paste DSL

`renderer.js#analyzeBulkText` parses each line of the bulk paste textarea. End-of-line modifiers (combinable, any order):

- **Bay filter**: `EVEN ONLY` / `ODDS ONLY` / `EVEN AND ODDS` (default)
- **Single location**: `SINGLE LOCATION` (or just write a code with no `THRU`)
- **Level order per bay**: `TOP DOWN` (`LEVELS DESC`) → 3,2,1 / `BOTTOM UP` (`LEVELS ASC`, default) → 1,2,3
- **Arrow override**: `{UP}` / `{DOWN}` / `{NONE}` — also accepts legacy `ARROW UP/DOWN/NONE`
- **Cross-prefix range**: `K2-…-… THRU K3-…-…` — expands for **both** prefixes
- **Inline arrow rules block**: lines like `-1 DOWN`, `-2 UP`, `-3 UP` set the per-level default for that paste only

Pill view click on the arrow badge cycles `UP → DOWN → NONE → UP` and writes `{DIR}` back to the underlying textarea. Default level rules when no override is given: Level 1 → DOWN, all higher levels → UP.

## Things I've burned time on; don't burn it again

- **Don't build the backend with `pyinstaller server.py` directly** — the spec uses `collect_all('barcode')` etc. to pull in data files. A bare invocation will produce an exe that crashes on launch.
- **Don't set `signAndEditExecutable: false`** in `build.win`. That blocks rcedit, which means the EXE keeps Electron's metadata (ProductName=Electron, CompanyName=GitHub Inc.) instead of SmartLabel's. We are NOT signing — leaving rcedit on still works fine without a cert.
- **Bulk Paste pill list scrolling** lives at `.bulk-pills { max-height: 360px; overflow-y: auto }`. Don't try to flex/grid it into filling space — that fight took a dozen iterations and the simple max-height won.
- **Window is locked at 1000×760** with `resizable: false, useContentSize: true`. The layout was tuned for that size; don't make it resizable without re-checking everything fits.
