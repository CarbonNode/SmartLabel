const API_BASE = "http://127.0.0.1:5555/api";

// --- State ---
let csvLocations = null; // holds parsed CSV data when in CSV mode
let activeTab = "manual";

// --- Dynamic arrow levels ---

let levels = [
  { level: "1", dir: "down" },
  { level: "2", dir: "down" },
  { level: "3", dir: "up" },
];

function renderLevels() {
  const container = document.getElementById("arrow-rules");
  container.innerHTML = levels
    .map(
      (l, i) => `
    <div class="rule">
      <label>Level ${l.level}:</label>
      <select onchange="levels[${i}].dir = this.value">
        <option value="down" ${l.dir === "down" ? "selected" : ""}>DOWN</option>
        <option value="up" ${l.dir === "up" ? "selected" : ""}>UP</option>
      </select>
      ${
        levels.length > 1
          ? `<button class="btn-remove-sm" onclick="removeLevel(${i})" title="Remove">X</button>`
          : ""
      }
    </div>
  `
    )
    .join("");
}

function addLevel() {
  const next = levels.length > 0 ? Math.max(...levels.map((l) => parseInt(l.level))) + 1 : 1;
  levels.push({ level: String(next), dir: "up" });
  renderLevels();
}

function removeLevel(i) {
  levels.splice(i, 1);
  renderLevels();
}

function getArrowRules() {
  const rules = {};
  levels.forEach((l) => (rules[l.level] = l.dir));
  return rules;
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

// --- Bulk paste ---

function parseBulk() {
  const text = document.getElementById("bulk-text").value.trim();
  if (!text) return;

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const container = document.getElementById("ranges-container");
  container.innerHTML = "";

  lines.forEach((line) => {
    const match = line.match(/^(\S+)\s+THRU\s+(\S+)$/i);
    if (match) {
      addRangeWithValues(match[1].toUpperCase(), match[2].toUpperCase());
    }
  });

  if (container.children.length === 0) {
    addRange();
    setStatus("Could not parse any ranges. Use format: K2-01-01-1 THRU K2-01-100-3");
  } else {
    switchTab("manual");
    setStatus(`Loaded ${container.children.length} range(s).`);
  }
}

async function bulkCsvUpload() {
  const text = await window.api.openCsv();
  if (text) {
    // Parse CSV and load into bulk text as ranges or switch to CSV mode
    switchTab("csv");
    loadCsvData(text);
  }
}

// --- Manual ranges ---

function addRangeWithValues(start, end) {
  const container = document.getElementById("ranges-container");
  const div = document.createElement("div");
  div.className = "range-row";
  div.innerHTML = `
    <input type="text" class="range-start" placeholder="K2-01-01-1" value="${start}" />
    <span class="thru">THRU</span>
    <input type="text" class="range-end" placeholder="K2-01-100-3" value="${end}" />
    <button class="btn-remove" onclick="removeRange(this)" title="Remove">X</button>
  `;
  container.appendChild(div);
}

function addRange() {
  addRangeWithValues("", "");
}

function removeRange(btn) {
  const container = document.getElementById("ranges-container");
  if (container.children.length > 1) {
    btn.closest(".range-row").remove();
  }
}

function getRanges() {
  const rows = document.querySelectorAll(".range-row");
  const ranges = [];
  rows.forEach((row) => {
    const start = row.querySelector(".range-start").value.trim().toUpperCase();
    const end = row.querySelector(".range-end").value.trim().toUpperCase();
    if (start && end) {
      ranges.push({ start, end });
    }
  });
  return ranges;
}

// --- Status ---

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function showProgressBar(show) {
  document.getElementById("progress-container").style.display = show ? "block" : "none";
  if (!show) updateProgressBar(0);
}

function updateProgressBar(pct) {
  document.getElementById("progress-fill").style.width = pct + "%";
}

// --- Preview ---

async function previewLabels() {
  // CSV mode - preview directly
  if (activeTab === "csv" && csvLocations) {
    const section = document.getElementById("preview-section");
    section.style.display = "block";
    document.getElementById("label-count").textContent = `(${csvLocations.length} labels = ${csvLocations.length} pages)`;

    const list = document.getElementById("preview-list");
    const shown = csvLocations.slice(0, 500);
    list.innerHTML = shown
      .map(
        (loc) => `
      <div class="preview-item">
        <span>${loc.code}</span>
        <span class="arrow-indicator">${loc.arrow === "up" ? "\u2191" : loc.arrow === "down" ? "\u2193" : "\u2014"}</span>
      </div>
    `
      )
      .join("");

    if (csvLocations.length > 500) {
      list.innerHTML += `<div class="preview-item" style="grid-column: 1/-1; text-align:center; color:#888;">... and ${csvLocations.length - 500} more</div>`;
    }
    setStatus(`${csvLocations.length} labels (12x4", 1 per page) ready to generate.`);
    return;
  }

  // Range mode
  const ranges = getRanges();
  if (ranges.length === 0) {
    setStatus("Enter at least one range.");
    return;
  }

  setStatus("Loading preview...");

  try {
    const res = await fetch(`${API_BASE}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranges, arrowRules: getArrowRules() }),
    });

    const data = await res.json();

    if (data.error) {
      setStatus(data.error);
      return;
    }

    const section = document.getElementById("preview-section");
    section.style.display = "block";
    document.getElementById("label-count").textContent = `(${data.count} labels = ${data.count} pages)`;

    const list = document.getElementById("preview-list");
    const shown = data.locations.slice(0, 500);
    list.innerHTML = shown
      .map(
        (loc) => `
      <div class="preview-item">
        <span>${loc.code}</span>
        <span class="arrow-indicator">${loc.arrow === "up" ? "\u2191" : loc.arrow === "down" ? "\u2193" : "\u2014"}</span>
      </div>
    `
      )
      .join("");

    if (data.count > 500) {
      list.innerHTML += `<div class="preview-item" style="grid-column: 1/-1; text-align:center; color:#888;">... and ${data.count - 500} more</div>`;
    }

    setStatus(`${data.count} labels (12x4", 1 per page) ready to generate.`);
  } catch (err) {
    setStatus("Error connecting to backend. Make sure it's running.");
    console.error(err);
  }
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
  } else {
    const ranges = getRanges();
    if (ranges.length === 0) {
      setStatus("Enter at least one range.");
      return;
    }
    fetchUrl = `${API_BASE}/generate`;
    fetchBody = JSON.stringify({ ranges, arrowRules: getArrowRules() });
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
        setStatus(`Generating PDF... ${p.current} / ${p.total} labels (${pct}%)`);
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
    showProgressBar(false);

    if (!res.ok) {
      const errData = await res.json();
      setStatus(errData.error || "Generation failed.");
      return;
    }

    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();

    const saved = await window.api.savePdf(buffer);
    if (saved) {
      setStatus(`PDF saved to: ${saved}`);
    } else {
      setStatus("Save cancelled.");
    }
  } catch (err) {
    clearInterval(progressInterval);
    showProgressBar(false);
    setStatus("Error generating PDF. Check the backend.");
    console.error(err);
  }
}

// --- Init ---
renderLevels();
