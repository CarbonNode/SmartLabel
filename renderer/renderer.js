const API_BASE = "http://127.0.0.1:5555/api";

// --- State ---
let csvLocations = null; // holds parsed CSV data when in CSV mode
let activeTab = "bulk";

// --- Default arrow rules ---
// Level 1 looks down at the floor; higher levels look up at the rack above.
// Override per-row in Manual Entry, per-line in Bulk Paste (`ARROW <DIR>` or `-N <DIR>`),
// or per-row in a CSV.
const DEFAULT_ARROW_RULES = { "1": "down", "2": "up", "3": "up", "4": "up", "5": "up", "6": "up" };

function getArrowRules() {
  return Object.assign({}, DEFAULT_ARROW_RULES);
}

// --- Tabs ---

function switchTab(mode) {
  activeTab = mode;
  document.getElementById("manual-input").style.display = mode === "manual" ? "block" : "none";
  document.getElementById("bulk-input").style.display = mode === "bulk" ? "block" : "none";
  document.getElementById("csv-input").style.display = mode === "csv" ? "block" : "none";
  document.getElementById("tab-manual").className = mode === "manual" ? "tab active" : "tab";
  document.getElementById("tab-bulk").className = mode === "bulk" ? "tab active" : "tab";
  document.getElementById("tab-csv").className = mode === "csv" ? "tab active" : "tab";
  if (mode === "bulk") {
    const { labels } = analyzeBulkText(getBulkText(), getArrowRules());
    if (labels.length > 0) showBulkPillsView();
    else showBulkPasteView();
  }
}

// --- CSV parsing ---

function parseCsvText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const locations = [];

  for (const line of lines) {
    // Skip header
    if (line.toLowerCase().startsWith("location")) continue;

    const parts = line.split(",");
    if (parts.length >= 2) {
      const code = parts[0].trim().toUpperCase();
      const rawArrow = parts[1].trim().toUpperCase();
      const arrow = rawArrow === "UP" ? "up" : rawArrow === "NONE" ? "none" : "down";
      if (code) {
        locations.push({ code, arrow });
      }
    }
  }
  return locations;
}

function loadCsvData(text) {
  csvLocations = parseCsvText(text);
  if (csvLocations.length === 0) {
    setStatus("No valid locations found in CSV.");
    csvLocations = null;
    return;
  }

  document.getElementById("csv-dropzone").style.display = "none";
  document.getElementById("csv-loaded").style.display = "block";

  const ups = csvLocations.filter((l) => l.arrow === "up").length;
  const downs = csvLocations.filter((l) => l.arrow === "down").length;
  const nones = csvLocations.filter((l) => l.arrow === "none").length;
  let summary = `<strong>${csvLocations.length}</strong> locations loaded &mdash; ${ups} UP, ${downs} DOWN`;
  if (nones > 0) summary += `, ${nones} NO ARROW`;
  summary += `<br><span class="drop-hint">First: ${csvLocations[0].code} &bull; Last: ${csvLocations[csvLocations.length - 1].code}</span>`;
  document.getElementById("csv-summary").innerHTML = summary;

  setStatus(`CSV loaded: ${csvLocations.length} locations.`);
}

function clearCsv() {
  csvLocations = null;
  document.getElementById("csv-dropzone").style.display = "flex";
  document.getElementById("csv-loaded").style.display = "none";
  setStatus("");
}

// CSV drag and drop
function csvDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("drag-over");
}

function csvDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function csvDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => loadCsvData(ev.target.result);
    reader.readAsText(file);
  }
}

async function csvBrowse() {
  const text = await window.api.openCsv();
  if (text) {
    loadCsvData(text);
  }
}

// --- Bulk paste DSL ---
// Supports:
//   <start> THRU <end>           (default: all bays, all levels in range)
//   <start> THRU <end> EVEN ONLY
//   <start> THRU <end> ODDS ONLY
//   <start> THRU <end> EVEN AND ODDS
//   <single-location>             (also: <single> SINGLE LOCATION)
//   Cross-prefix:  K2-… THRU K3-… expands both prefixes
//   -N UP|DOWN|NONE               (override arrow for level N for this bulk paste)
//   blank lines / # or // comments / "AAROW INFORMATION" headers / unrecognized lines: ignored

function pad(n, w) { return String(n).padStart(w, "0"); }

function parseLoc(s) {
  const parts = s.toUpperCase().split("-");
  if (parts.length === 4) {
    return { prefix: parts[0], aisle: parts[1], bay: parts[2], level: parts[3], shape: 4 };
  }
  if (parts.length === 3) {
    return { prefix: parts[0], zone: parts[1], number: parts[2], shape: 3 };
  }
  return null;
}

function expandRange(startStr, endStr, modifier, arrowRules, arrowOverride, levelOrder) {
  const s = parseLoc(startStr);
  const e = parseLoc(endStr);
  if (!s || !e || s.shape !== e.shape) return [];

  const out = [];
  if (s.shape === 3) {
    if (s.prefix !== e.prefix || s.zone !== e.zone) return [];
    const start = parseInt(s.number);
    const end = parseInt(e.number);
    for (let n = start; n <= end; n++) {
      if (modifier === "even" && n % 2 !== 0) continue;
      if (modifier === "odd" && n % 2 === 0) continue;
      out.push({ code: `${s.prefix}-${s.zone}-${pad(n, 3)}`, arrow: arrowOverride || "none" });
    }
    return out;
  }

  const aisleStart = parseInt(s.aisle);
  const aisleEnd = parseInt(e.aisle);
  const bayStart = parseInt(s.bay);
  const bayEnd = parseInt(e.bay);
  const levelStart = parseInt(s.level);
  const levelEnd = parseInt(e.level);

  const levels = [];
  if (levelOrder === "desc") {
    for (let l = levelEnd; l >= levelStart; l--) levels.push(l);
  } else {
    for (let l = levelStart; l <= levelEnd; l++) levels.push(l);
  }

  const prefixes = s.prefix === e.prefix ? [s.prefix] : [s.prefix, e.prefix];

  for (const prefix of prefixes) {
    for (let a = aisleStart; a <= aisleEnd; a++) {
      for (let b = bayStart; b <= bayEnd; b++) {
        if (modifier === "even" && b % 2 !== 0) continue;
        if (modifier === "odd" && b % 2 === 0) continue;
        for (const l of levels) {
          const code = `${prefix}-${pad(a, 2)}-${pad(b, 3)}-${l}`;
          const arrow = arrowOverride || arrowRules[String(l)] || "up";
          out.push({ code, arrow });
        }
      }
    }
  }
  return out;
}

function analyzeBulkText(text, baseArrowRules) {
  const arrowRules = Object.assign({}, baseArrowRules);
  const rawLines = text.split(/\r?\n/);

  for (const raw of rawLines) {
    const t = raw.trim().toUpperCase();
    const m = t.match(/^-(\d+)\s+(UP|DOWN|NONE)\s*$/);
    if (m) arrowRules[m[1]] = m[2].toLowerCase();
  }

  const labels = [];
  const lineInfos = [];

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const raw = rawLines[lineIndex];
    let t = raw.trim();
    if (!t) continue;
    if (t.startsWith("#") || t.startsWith("//")) {
      lineInfos.push({ kind: "comment", raw: t, lineIndex });
      continue;
    }
    const upper = t.toUpperCase();
    if (/^AA?RROW\s+INFORMATION/.test(upper)) {
      lineInfos.push({ kind: "header", raw: t, lineIndex });
      continue;
    }
    const arrowRuleMatch = upper.match(/^-(\d+)\s+(UP|DOWN|NONE)\s*$/);
    if (arrowRuleMatch) {
      lineInfos.push({ kind: "arrow-rule", level: arrowRuleMatch[1], dir: arrowRuleMatch[2].toLowerCase(), raw: t, lineIndex });
      continue;
    }

    let cleaned = upper;
    let arrowOverride = null;
    let levelOrder = "asc";

    // Strip per-line arrow override — supports both "{UP}" and "ARROW UP"
    const arrowOv = cleaned.match(/(?:\{(UP|DOWN|NONE)\}|\bARROW\s+(UP|DOWN|NONE))\s*$/);
    if (arrowOv) {
      arrowOverride = (arrowOv[1] || arrowOv[2]).toLowerCase();
      cleaned = cleaned
        .replace(/\s*(?:\{(?:UP|DOWN|NONE)\}|\bARROW\s+(?:UP|DOWN|NONE))\s*$/, "")
        .trim();
    }

    // Strip level order — TOP DOWN / BOTTOM UP / LEVELS DESC / LEVELS ASC
    if (/\b(?:TOP\s+DOWN|LEVELS\s+DESC)\s*$/.test(cleaned)) {
      levelOrder = "desc";
      cleaned = cleaned.replace(/\s*(?:TOP\s+DOWN|LEVELS\s+DESC)\s*$/, "").trim();
    } else if (/\b(?:BOTTOM\s+UP|LEVELS\s+ASC)\s*$/.test(cleaned)) {
      levelOrder = "asc";
      cleaned = cleaned.replace(/\s*(?:BOTTOM\s+UP|LEVELS\s+ASC)\s*$/, "").trim();
    }

    let modifier = "all";
    if (/\bEVEN\s+ONLY\s*$/.test(cleaned)) {
      modifier = "even";
      cleaned = cleaned.replace(/\s*EVEN\s+ONLY\s*$/, "").trim();
    } else if (/\b(ODDS?|ODD)\s+ONLY\s*$/.test(cleaned)) {
      modifier = "odd";
      cleaned = cleaned.replace(/\s*(ODDS?|ODD)\s+ONLY\s*$/, "").trim();
    } else if (/\bEVEN\s+AND\s+ODDS?\s*$/.test(cleaned)) {
      modifier = "all";
      cleaned = cleaned.replace(/\s*EVEN\s+AND\s+ODDS?\s*$/, "").trim();
    } else if (/\bSINGLE\s+LOCATION\s*$/.test(cleaned)) {
      cleaned = cleaned.replace(/\s*SINGLE\s+LOCATION\s*$/, "").trim();
    }

    const thru = cleaned.match(/^(\S+)\s+THRU\s+(\S+)$/);
    if (thru) {
      const expanded = expandRange(thru[1], thru[2], modifier, arrowRules, arrowOverride, levelOrder);
      labels.push(...expanded);
      const s = parseLoc(thru[1]);
      const e = parseLoc(thru[2]);
      const crossPrefix = s && e && s.shape === 4 && e.shape === 4 && s.prefix !== e.prefix;
      // Inferred arrow for display (uses level of start when override absent)
      const displayArrow = arrowOverride
        || (s && s.shape === 4 ? arrowRules[s.level] : null)
        || (s && s.shape === 3 ? "none" : "up");
      lineInfos.push({
        kind: "range",
        start: thru[1],
        end: thru[2],
        modifier,
        crossPrefix,
        count: expanded.length,
        valid: expanded.length > 0,
        arrowOverride,
        displayArrow,
        levelOrder,
        lineIndex,
      });
      continue;
    }

    const single = cleaned.split(/\s+/)[0];
    const loc = parseLoc(single);
    if (loc) {
      const arrow = arrowOverride || (loc.shape === 4 ? (arrowRules[loc.level] || "up") : "none");
      labels.push({ code: single, arrow });
      lineInfos.push({
        kind: "single",
        code: single,
        arrow,
        arrowOverride,
        count: 1,
        valid: true,
        lineIndex,
      });
    } else {
      lineInfos.push({ kind: "unknown", raw: t, valid: false, lineIndex });
    }
  }

  return { labels, lineInfos, arrowRules };
}

function expandBulkText(text, baseArrowRules) {
  return analyzeBulkText(text, baseArrowRules).labels;
}

// --- Bulk paste actions ---

function getBulkText() {
  return document.getElementById("bulk-text").value;
}

let bulkView = "paste"; // "paste" | "pills"

function showBulkPasteView() {
  bulkView = "paste";
  document.getElementById("bulk-paste-view").style.display = "block";
  document.getElementById("bulk-pills-view").style.display = "none";
  setTimeout(() => document.getElementById("bulk-text").focus(), 0);
}

function showBulkPillsView() {
  bulkView = "pills";
  document.getElementById("bulk-paste-view").style.display = "none";
  document.getElementById("bulk-pills-view").style.display = "block";
  updateBulkCount();
}

function maybeAutoSwitchToPills() {
  const { labels, lineInfos } = analyzeBulkText(getBulkText(), getArrowRules());
  const hasContent = lineInfos.some((i) => i.kind === "range" || i.kind === "single");
  if (hasContent) showBulkPillsView();
}

function onBulkInput() {
  // Live count while typing (in paste view) — does not auto-switch
  updateBulkCount();
}

function clearBulkText() {
  document.getElementById("bulk-text").value = "";
  showBulkPasteView();
  updateBulkCount();
}

function quickAddBulkLine() {
  const input = document.getElementById("bulk-quickadd-input");
  const newLine = input.value.trim();
  if (!newLine) return;
  const ta = document.getElementById("bulk-text");
  const cur = ta.value.replace(/\s+$/, "");
  ta.value = cur ? `${cur}\n${newLine}` : newLine;
  input.value = "";
  updateBulkCount();
  // Stay in pills view (already there)
  input.focus();
}

function updateBulkCount() {
  const { labels, lineInfos } = analyzeBulkText(getBulkText(), getArrowRules());
  const text = `${labels.length.toLocaleString()} label${labels.length === 1 ? "" : "s"}`;

  for (const id of ["bulk-count", "bulk-count-paste"]) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      el.classList.toggle("has-labels", labels.length > 0);
    }
  }

  const showPillsBtn = document.getElementById("btn-show-pills");
  if (showPillsBtn) showPillsBtn.disabled = labels.length === 0;

  renderBulkPills(lineInfos);
}

const ARROW_GLYPH = { up: "↑", down: "↓", none: "—" };

function arrowLabel(dir) {
  return `${ARROW_GLYPH[dir] || "↑"} ${dir.toUpperCase()}`;
}

function modifierBadge(modifier, isSingle) {
  if (isSingle)        return { label: "Single", className: "bp-mod-single" };
  if (modifier === "even") return { label: "Even Only", className: "bp-mod-even" };
  if (modifier === "odd")  return { label: "Odds Only", className: "bp-mod-odd" };
  return { label: "All Bays", className: "bp-mod-all" };
}

function renderBulkPills(lineInfos) {
  const list = document.getElementById("bulk-pills");
  list.replaceChildren();

  for (const info of lineInfos) {
    if (info.kind === "header" || info.kind === "arrow-rule" || info.kind === "comment") {
      const note = document.createElement("div");
      note.className = "bp-row-comment";
      if (info.kind === "arrow-rule") {
        note.textContent = `↳ Level ${info.level} arrow override → ${info.dir.toUpperCase()}`;
      } else {
        note.textContent = `↳ ${info.raw}`;
      }
      list.append(note);
      continue;
    }

    const row = document.createElement("div");
    row.className = "bp-row";
    if (!info.valid) row.classList.add("invalid");

    const range = document.createElement("div");
    range.className = "bp-range";
    if (info.kind === "range") {
      const startSpan = document.createElement("span"); startSpan.textContent = info.start;
      const sep = document.createElement("span"); sep.className = "arrow-sep"; sep.textContent = "→";
      const endSpan = document.createElement("span"); endSpan.textContent = info.end;
      range.append(startSpan, sep, endSpan);
    } else if (info.kind === "single") {
      const codeSpan = document.createElement("span"); codeSpan.textContent = info.code;
      range.append(codeSpan);
    } else {
      range.textContent = info.raw || "(unrecognized line)";
    }

    const badge = document.createElement("span");
    const mod = modifierBadge(info.modifier, info.kind === "single");
    badge.className = `bp-badge ${mod.className}`;
    badge.textContent = mod.label;

    const arrowBtn = document.createElement("span");
    const dir = info.kind === "range" ? info.displayArrow : info.arrow;
    arrowBtn.className = `bp-badge bp-arrow ${dir}`;
    if (info.arrowOverride) arrowBtn.classList.add("overridden");
    arrowBtn.textContent = arrowLabel(dir || "up");
    arrowBtn.title = info.arrowOverride
      ? "Click to cycle (overridden)"
      : "Click to override arrow for this range";
    arrowBtn.addEventListener("click", () => cycleLineArrow(info.lineIndex, dir || "up"));

    const countEl = document.createElement("span");
    countEl.className = "bp-count";
    countEl.textContent = `${info.count} label${info.count === 1 ? "" : "s"}`;

    row.append(range, badge, arrowBtn, countEl);

    if (info.kind === "range" && info.levelOrder === "desc") {
      const order = document.createElement("span");
      order.className = "bp-badge bp-mod-order";
      order.textContent = "Top → Down";
      order.title = "Levels print high → low per bay";
      row.append(order);
    }

    if (info.crossPrefix) {
      const meta = document.createElement("div");
      meta.className = "bp-meta-row";
      const cross = document.createElement("span");
      cross.className = "bp-badge bp-mod-cross";
      cross.textContent = `Cross-prefix · ${info.start.split("-")[0]} + ${info.end.split("-")[0]}`;
      meta.append(cross);
      row.append(meta);
    }

    list.append(row);
  }
}

function cycleLineArrow(lineIndex, currentDir) {
  const next = currentDir === "up" ? "down" : currentDir === "down" ? "none" : "up";
  const text = getBulkText();
  const lines = text.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  let line = lines[lineIndex];
  // Strip any existing arrow override at end (either {DIR} or ARROW DIR)
  line = line
    .replace(/\s*(?:\{(?:UP|DOWN|NONE)\}|\bARROW\s+(?:UP|DOWN|NONE))\s*$/i, "")
    .replace(/\s+$/, "");
  // Append explicit override using the cleaner {DIR} form
  line = `${line} {${next.toUpperCase()}}`;
  lines[lineIndex] = line;
  const ta = document.getElementById("bulk-text");
  ta.value = lines.join("\n");
  updateBulkCount();
}

async function bulkCsvUpload() {
  const text = await window.api.openCsv();
  if (text) {
    switchTab("csv");
    loadCsvData(text);
  }
}

// --- Manual ranges ---

function addRangeWithValues(start, end, modifier, arrowOverride) {
  modifier = modifier || "all";
  arrowOverride = arrowOverride || "auto";
  const container = document.getElementById("ranges-container");
  const div = document.createElement("div");
  div.className = "range-row";

  const startInput = document.createElement("input");
  startInput.type = "text";
  startInput.className = "range-start";
  startInput.placeholder = "K2-01-01-1";
  startInput.value = start;

  const thru = document.createElement("span");
  thru.className = "thru";
  thru.textContent = "THRU";

  const endInput = document.createElement("input");
  endInput.type = "text";
  endInput.className = "range-end";
  endInput.placeholder = "K2-01-100-3";
  endInput.value = end;

  const modSel = document.createElement("select");
  modSel.className = "range-modifier";
  ["all", "even", "odd"].forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = { all: "All Bays", even: "Even Only", odd: "Odds Only" }[v];
    if (v === modifier) opt.selected = true;
    modSel.appendChild(opt);
  });

  const arrowSel = document.createElement("select");
  arrowSel.className = "range-arrow";
  ["auto", "up", "down", "none"].forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = { auto: "↕ Auto", up: "↑ UP", down: "↓ DOWN", none: "— NONE" }[v];
    if (v === arrowOverride) opt.selected = true;
    arrowSel.appendChild(opt);
  });

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove";
  removeBtn.title = "Remove";
  removeBtn.textContent = "X";
  removeBtn.addEventListener("click", () => removeRange(removeBtn));

  div.append(startInput, thru, endInput, modSel, arrowSel, removeBtn);
  container.appendChild(div);
}

function addRange() {
  addRangeWithValues("", "", "all", "auto");
}

function removeRange(btn) {
  const container = document.getElementById("ranges-container");
  if (container.children.length > 1) {
    btn.closest(".range-row").remove();
  }
}

function getManualRows() {
  const rows = document.querySelectorAll(".range-row");
  const out = [];
  rows.forEach((row) => {
    const start = row.querySelector(".range-start").value.trim().toUpperCase();
    const endVal = row.querySelector(".range-end").value.trim().toUpperCase();
    const modifier = row.querySelector(".range-modifier").value;
    const arrowSel = row.querySelector(".range-arrow").value;
    const arrowOverride = arrowSel === "auto" ? null : arrowSel;
    if (!start) return;
    out.push({ start, end: endVal || start, modifier, arrowOverride, single: !endVal });
  });
  return out;
}

function expandManualRows(arrowRules) {
  const rows = getManualRows();
  const out = [];
  for (const r of rows) {
    if (r.single) {
      const loc = parseLoc(r.start);
      if (!loc) continue;
      const arrow = r.arrowOverride || (loc.shape === 4 ? (arrowRules[loc.level] || "up") : "none");
      out.push({ code: r.start, arrow });
    } else {
      out.push(...expandRange(r.start, r.end, r.modifier, arrowRules, r.arrowOverride));
    }
  }
  return out;
}

// --- Status ---

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function showProgressBar(show) {
  const overlay = document.getElementById("gen-overlay");
  if (show) {
    document.getElementById("gen-progress-state").style.display = "block";
    document.getElementById("gen-done-state").style.display = "none";
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
    updateProgressBar(0);
    document.getElementById("gen-count").textContent = "Preparing…";
  } else {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
    updateProgressBar(0);
  }
}

function showGenSuccess(savedPath) {
  document.getElementById("gen-progress-state").style.display = "none";
  document.getElementById("gen-done-state").style.display = "block";
  document.getElementById("gen-path").textContent = savedPath;
  const overlay = document.getElementById("gen-overlay");
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
}

function dismissGenOverlay() {
  const overlay = document.getElementById("gen-overlay");
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

function updateProgressBar(pct) {
  document.getElementById("gen-fill").style.width = pct + "%";
}

function setGenCount(text) {
  document.getElementById("gen-count").textContent = text;
}

// --- Preview ---

function renderPreviewList(locations, count) {
  const section = document.getElementById("preview-section");
  section.style.display = "block";
  document.getElementById("label-count").textContent = `(${count} labels = ${count} pages)`;

  const list = document.getElementById("preview-list");
  list.replaceChildren();
  const shown = locations.slice(0, 500);
  for (const loc of shown) {
    const item = document.createElement("div");
    item.className = "preview-item";
    const codeSpan = document.createElement("span");
    codeSpan.textContent = loc.code;
    const arrowSpan = document.createElement("span");
    arrowSpan.className = "arrow-indicator";
    arrowSpan.textContent = loc.arrow === "up" ? "↑" : loc.arrow === "down" ? "↓" : "—";
    item.append(codeSpan, arrowSpan);
    list.append(item);
  }
  if (count > 500) {
    const more = document.createElement("div");
    more.className = "preview-item";
    more.style.cssText = "grid-column: 1/-1; text-align:center; color:#888;";
    more.textContent = `... and ${count - 500} more`;
    list.append(more);
  }
}

async function previewLabels() {
  // Bulk paste mode - expand DSL locally
  if (activeTab === "bulk") {
    const expanded = expandBulkText(getBulkText(), getArrowRules());
    if (expanded.length === 0) {
      setStatus("Nothing to preview. Paste at least one range.");
      return;
    }
    renderPreviewList(expanded, expanded.length);
    setStatus(`${expanded.length} labels (12x4", 1 per page) ready to generate.`);
    return;
  }

  // CSV mode - preview directly
  if (activeTab === "csv" && csvLocations) {
    renderPreviewList(csvLocations, csvLocations.length);
    setStatus(`${csvLocations.length} labels (12x4", 1 per page) ready to generate.`);
    return;
  }

  // Manual range mode (frontend expansion)
  const expanded = expandManualRows(getArrowRules());
  if (expanded.length === 0) {
    setStatus("Enter at least one range.");
    return;
  }
  renderPreviewList(expanded, expanded.length);
  setStatus(`${expanded.length} labels (12x4", 1 per page) ready to generate.`);
}

// --- Generate ---

async function generatePdf() {
  let fetchUrl, fetchBody;

  if (activeTab === "csv" && csvLocations) {
    if (csvLocations.length === 0) {
      setStatus("No CSV data loaded.");
      return;
    }
    fetchUrl = `${API_BASE}/generate-direct`;
    fetchBody = JSON.stringify({ locations: csvLocations });
  } else if (activeTab === "bulk") {
    const expanded = expandBulkText(getBulkText(), getArrowRules());
    if (expanded.length === 0) {
      setStatus("Nothing to generate. Paste at least one range.");
      return;
    }
    fetchUrl = `${API_BASE}/generate-direct`;
    fetchBody = JSON.stringify({ locations: expanded });
  } else {
    const expanded = expandManualRows(getArrowRules());
    if (expanded.length === 0) {
      setStatus("Enter at least one range.");
      return;
    }
    fetchUrl = `${API_BASE}/generate-direct`;
    fetchBody = JSON.stringify({ locations: expanded });
  }

  setStatus("Generating PDF...");
  showProgressBar(true);

  // Poll progress while generating
  const progressInterval = setInterval(async () => {
    try {
      const pRes = await fetch(`${API_BASE}/progress`);
      const p = await pRes.json();
      if (p.total > 0) {
        const pct = Math.round((p.current / p.total) * 100);
        setGenCount(`${p.current} / ${p.total} labels  ·  ${pct}%`);
        updateProgressBar(pct);
      }
    } catch {}
  }, 500);

  try {
    const res = await fetch(fetchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: fetchBody,
    });

    clearInterval(progressInterval);

    if (!res.ok) {
      dismissGenOverlay();
      const errData = await res.json();
      setStatus(errData.error || "Generation failed.");
      return;
    }

    setGenCount("Saving file…");
    updateProgressBar(100);

    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();

    const saved = await window.api.savePdf(buffer);
    if (saved) {
      showGenSuccess(saved);
      setStatus("");
    } else {
      dismissGenOverlay();
      setStatus("Save cancelled.");
    }
  } catch (err) {
    clearInterval(progressInterval);
    dismissGenOverlay();
    setStatus("Error generating PDF. Check the backend.");
    console.error(err);
  }
}

// --- Help / guide ---

async function openGuide() {
  if (window.api && window.api.openGuide) {
    const ok = await window.api.openGuide();
    if (!ok) setStatus("Could not find the guide file.");
  }
}

async function openExamples() {
  if (window.api && window.api.openExamples) {
    const ok = await window.api.openExamples();
    if (!ok) setStatus("Could not find the examples.");
  }
}

async function openPromptGuide() {
  if (window.api && window.api.openPromptGuide) {
    const ok = await window.api.openPromptGuide();
    if (!ok) setStatus("Could not find the prompt guide.");
  }
}

// --- Auto-update toast ---

let dismissedUpdateVersion = null;
let updateInProgress = false;
let availableUpdateVersion = null;

function setUpdateState(state) {
  document.querySelector(".up-state-available").style.display = state === "available" ? "grid" : "none";
  document.querySelector(".up-state-downloading").style.display = state === "downloading" ? "grid" : "none";
  document.querySelector(".up-state-ready").style.display = state === "ready" ? "grid" : "none";
}

function showUpdateToast(state) {
  setUpdateState(state);
  const toast = document.getElementById("update-toast");
  toast.classList.add("show");
  toast.setAttribute("aria-hidden", "false");
}

function dismissUpdateToast() {
  const toast = document.getElementById("update-toast");
  toast.classList.remove("show");
  toast.setAttribute("aria-hidden", "true");
  // Remember user dismissed this version so we don't keep nagging
  if (availableUpdateVersion && !updateInProgress) {
    dismissedUpdateVersion = availableUpdateVersion;
  }
}

async function startUpdateDownload() {
  updateInProgress = true;
  showUpdateToast("downloading");
  document.getElementById("up-progress-sub").textContent = "Starting…";
  document.getElementById("up-bar-fill").style.width = "0%";
  if (window.api && window.api.downloadUpdate) {
    const r = await window.api.downloadUpdate();
    if (r && r.ok === false) {
      updateInProgress = false;
      dismissUpdateToast();
      setStatus(`Update download failed: ${r.error || "unknown error"}`);
    }
  }
}

async function installUpdateNow() {
  if (window.api && window.api.installUpdate) {
    await window.api.installUpdate();
  }
}

if (window.api && window.api.onUpdateEvent) {
  window.api.onUpdateEvent((channel, payload) => {
    if (channel === "update-available") {
      const version = payload && payload.version;
      // Don't re-nag on the same version after dismissal, and don't interrupt an in-progress download
      if (updateInProgress) return;
      if (version && version === dismissedUpdateVersion) return;
      availableUpdateVersion = version;
      const v = version ? `v${version}` : "new version";
      document.getElementById("up-version-sub").textContent = `${v} ready to install`;
      showUpdateToast("available");
    } else if (channel === "update-progress") {
      const pct = payload && typeof payload.percent === "number" ? payload.percent : 0;
      document.getElementById("up-bar-fill").style.width = `${pct}%`;
      document.getElementById("up-progress-sub").textContent = `${pct}%`;
    } else if (channel === "update-downloaded") {
      updateInProgress = false;
      showUpdateToast("ready");
    } else if (channel === "update-error") {
      console.log("[updater]", payload && payload.message);
    }
  });
}

// --- Init ---
for (let i = 0; i < 6; i++) addRange();
showBulkPasteView();
