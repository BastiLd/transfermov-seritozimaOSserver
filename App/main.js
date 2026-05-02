const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require("electron");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

const APP_NAME = "Plex Transfer";
const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".mpg", ".mpeg"]);
const ROBOCOPY_SERIAL_THREADS = 32;
const ROBOCOPY_PARALLEL_THREADS = 8;
const ROBOCOPY_BASE_FLAGS = ["/J", "/R:1", "/W:1", "/FFT", "/TEE", "/XC", "/XN", "/XO"];
const PROBE_SIZE = 1024 * 1024 * 1024;

const DEFAULT_CONFIG = {
  movies_root: "Z:\\Movies",
  series_root: "Z:\\Series",
  plex_url: "",
  plex_token: "",
  movies_section_id: "",
  series_section_id: "",
  parallel_enabled: false,
  auto_refresh: false,
  theme_mode: "hell",
  remember_pending_jobs: true,
  pending_jobs: [],
  last_measured_bytes_per_sec: 0,
  last_measured_at: "",
  last_measured_source: ""
};

let mainWindow;
let running = false;
let speedTestRunning = false;
let activeProcesses = new Set();
let currentLogPath = null;

function runtimeDir() {
  if (!app.isPackaged) return __dirname;
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
}

function configPath() {
  return path.join(runtimeDir(), "config.json");
}

function bundledConfigPath() {
  return app.isPackaged ? path.join(process.resourcesPath, "default-config.json") : path.join(__dirname, "default-config.json");
}

function logsDir() {
  return path.join(runtimeDir(), "logs");
}

function tmpProbeDir() {
  return path.join(runtimeDir(), "tmp_probe");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function expandHome(rawPath) {
  if (!rawPath || !rawPath.startsWith("~")) return rawPath;
  return path.join(os.homedir(), rawPath.slice(1));
}

function loadConfig() {
  const targetConfig = configPath();
  if (!fs.existsSync(targetConfig) && fs.existsSync(bundledConfigPath())) {
    try {
      fs.copyFileSync(bundledConfigPath(), targetConfig);
    } catch {
      // Fall back to defaults if the runtime directory is not writable.
    }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(targetConfig, "utf8"));
    const config = { ...DEFAULT_CONFIG, ...parsed };
    if (!["hell", "dunkel"].includes(config.theme_mode)) config.theme_mode = "hell";
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify({ ...DEFAULT_CONFIG, ...config }, null, 2), "utf8");
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isoLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function send(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function appendLog(message, isError = false) {
  send("copy:log", { message, isError });
  if (currentLogPath) {
    ensureDir(path.dirname(currentLogPath));
    const stamp = new Date().toLocaleTimeString("de-DE", { hour12: false });
    fs.appendFileSync(currentLogPath, `[${stamp}] ${message}\n`, "utf8");
  }
}

function sanitizeName(rawName) {
  const invalidChars = /[<>:"/\\|?*]/g;
  return (rawName || "Unbekannt")
    .replace(invalidChars, "_")
    .replace(/[._]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[ ._-]+|[ ._-]+$/g, "") || "Unbekannt";
}

function normalizeTitle(rawName, mediaType) {
  let cleaned = sanitizeName(rawName);
  if (mediaType === "Film") {
    cleaned = cleaned.replace(/[\s._-]*(2160p|1080p|720p|480p|bluray|brrip|web[-_. ]?dl|webrip|hdrip|dvdrip|x264|x265|h\.?264|h\.?265|hevc|dts|aac[.\d]*|ac3|yts|etrg|proper|repack|remux|multi|german|dubbed)(?:[\s._-]+.*)?$/i, "");
  }
  return cleaned.replace(/\s+/g, " ").replace(/^[ ._-]+|[ ._-]+$/g, "") || "Unbekannt";
}

function looksLikeVideo(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function detectSeasonNumber(name) {
  const match = /(?:s(\d{1,2})\s*e\d{1,2})|(?:(\d{1,2})x\d{1,2})/i.exec(name);
  if (!match) return null;
  return Number(match[1] || match[2]);
}

function extractShowNameFromEpisode(name) {
  const match = /(?:s\d{1,2}\s*e\d{1,2})|(?:\d{1,2}x\d{1,2})/i.exec(name);
  if (!match) return normalizeTitle(name, "Serie");
  return normalizeTitle(name.slice(0, match.index).replace(/[\s._-]+$/g, ""), "Serie");
}

function hasSeasonSubfolders(sourceDir) {
  try {
    return fs.readdirSync(sourceDir, { withFileTypes: true }).some((entry) => (
      entry.isDirectory() && /^(season|staffel|saison|series)\s*\d+|^s\d{1,2}$/i.test(entry.name.trim())
    ));
  } catch {
    return false;
  }
}

function calculateSourceSize(sourcePath) {
  try {
    const stat = fs.statSync(sourcePath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
  } catch {
    return 0;
  }

  let total = 0;
  const stack = [sourcePath];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(entryPath).size;
        } catch {
          // Ignore unreadable files while estimating, same as the Python app.
        }
      }
    }
  }
  return total;
}

function formatSize(sizeBytes) {
  if (!sizeBytes || sizeBytes <= 0) return "-";
  let value = Number(sizeBytes);
  for (const unit of ["B", "KB", "MB", "GB", "TB"]) {
    if (value < 1024 || unit === "TB") {
      if (unit === "B") return `${Math.trunc(value)} ${unit}`;
      return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return "-";
}

function driveRootFor(rawPath) {
  const resolved = path.resolve(expandHome(rawPath || ""));
  return path.parse(resolved).root || resolved;
}

function diskFreeBytes(rawPath) {
  const resolved = path.resolve(expandHome(rawPath || ""));
  if (!fs.existsSync(resolved)) return { exists: false, free: 0, error: "Pfad nicht erreichbar" };

  try {
    const stat = fs.statfsSync(resolved);
    return { exists: true, free: Number(stat.bavail || stat.bfree || 0) * Number(stat.bsize || 0), error: "" };
  } catch {
    // Windows fallback for Electron/Node builds where statfs is not available for a path.
  }

  try {
    const root = driveRootFor(resolved).replace(/\\+$/, "");
    const driveName = root.endsWith(":") ? root : root.slice(0, 2);
    const output = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ([System.IO.DriveInfo]::new('${driveName}')).AvailableFreeSpace`],
      { encoding: "utf8", windowsHide: true, timeout: 5000 }
    ).trim();
    const free = Number(output);
    return Number.isFinite(free) ? { exists: true, free, error: "" } : { exists: true, free: 0, error: "Speicherplatz unbekannt" };
  } catch (error) {
    return { exists: true, free: 0, error: error.message || "Speicherplatz unbekannt" };
  }
}

function targetStorageSummary(jobs) {
  const config = loadConfig();
  const buckets = new Map();
  for (const job of jobs || []) {
    if (!job || ["Kopiert", "Uebersprungen", "Übersprungen"].includes(job.status) || String(job.status || "").startsWith("Fehler")) continue;
    const root = expandHome(job.media_type === "Film" ? config.movies_root : config.series_root);
    if (!root) continue;
    const current = buckets.get(root) || { root, planned_bytes: 0 };
    current.planned_bytes += Number(job.size_bytes || 0);
    buckets.set(root, current);
  }

  return [...buckets.values()].map((item) => {
    const disk = diskFreeBytes(item.root);
    return {
      ...item,
      exists: disk.exists,
      free_bytes: disk.free,
      after_bytes: disk.exists ? disk.free - item.planned_bytes : 0,
      ok: disk.exists && (!disk.free || disk.free >= item.planned_bytes),
      error: disk.error
    };
  });
}

function openPathSmart(rawPath) {
  const resolved = path.resolve(expandHome(rawPath || ""));
  if (!fs.existsSync(resolved)) {
    const parent = path.dirname(resolved);
    if (parent && parent !== resolved && fs.existsSync(parent)) {
      shell.openPath(parent);
      return parent;
    }
    throw new Error(`Pfad ist aktuell nicht erreichbar:\n${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    shell.showItemInFolder(resolved);
    return resolved;
  }
  shell.openPath(resolved);
  return resolved;
}

function buildJob(sourcePath, forcedType) {
  const config = loadConfig();
  const resolvedPath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedPath)) throw new Error(`Pfad nicht gefunden:\n${resolvedPath}`);
  const stat = fs.statSync(resolvedPath);
  let mediaType = forcedType || null;

  if (!mediaType) {
    if (stat.isDirectory()) {
      mediaType = "Serie";
    } else if (stat.isFile() && looksLikeVideo(resolvedPath)) {
      mediaType = detectSeasonNumber(path.parse(resolvedPath).name) ? "Serie" : "Film";
    } else {
      throw new Error(`Nicht unterstützter Pfad:\n${resolvedPath}`);
    }
  }

  let targetPath;
  if (mediaType === "Film") {
    if (!stat.isFile()) throw new Error(`Ein Film muss eine Videodatei sein:\n${resolvedPath}`);
    targetPath = path.join(expandHome(config.movies_root), path.basename(resolvedPath));
  } else {
    if (stat.isDirectory()) {
      const showName = normalizeTitle(path.basename(resolvedPath), "Serie");
      if (hasSeasonSubfolders(resolvedPath)) {
        targetPath = path.join(expandHome(config.series_root), showName);
      } else {
        let season = 1;
        try {
          for (const entry of fs.readdirSync(resolvedPath, { withFileTypes: true })) {
            if (entry.isFile() && looksLikeVideo(entry.name)) {
              season = detectSeasonNumber(path.parse(entry.name).name) || season;
              break;
            }
          }
        } catch {
          // Keep season 1 if the folder cannot be inspected.
        }
        targetPath = path.join(expandHome(config.series_root), showName, `Season ${String(season).padStart(2, "0")}`);
      }
    } else {
      if (!stat.isFile() || !looksLikeVideo(resolvedPath)) {
        throw new Error(`Eine Serie muss ein Ordner oder eine Episodendatei sein:\n${resolvedPath}`);
      }
      const season = detectSeasonNumber(path.parse(resolvedPath).name) || 1;
      const showName = extractShowNameFromEpisode(path.parse(resolvedPath).name);
      targetPath = path.join(expandHome(config.series_root), showName, `Season ${String(season).padStart(2, "0")}`, path.basename(resolvedPath));
    }
  }

  const sizeBytes = calculateSourceSize(resolvedPath);
  return {
    source: resolvedPath,
    target: targetPath,
    media_type: mediaType,
    status: "Bereit",
    progress: "-",
    live_speed_bytes_per_sec: 0,
    size_bytes: sizeBytes,
    size_label: formatSize(sizeBytes),
    return_code: null
  };
}

function robocopyFlags(config) {
  const threads = config.parallel_enabled ? ROBOCOPY_PARALLEL_THREADS : ROBOCOPY_SERIAL_THREADS;
  return [`/MT:${threads}`, ...ROBOCOPY_BASE_FLAGS];
}

function buildRobocopyCommand(job, config) {
  const flags = robocopyFlags(config);
  if (job.media_type === "Film") {
    return {
      command: "robocopy",
      args: [path.dirname(job.source), path.dirname(job.target), path.basename(job.source), ...flags]
    };
  }
  return {
    command: "robocopy",
    args: [job.source, job.target, "/E", ...flags]
  };
}

function extractProgress(line) {
  const match = /(\d{1,3}(?:\.\d+)?)%/.exec(line);
  return match ? `${match[1]}%` : null;
}

function extractSpeed(line) {
  const normalized = line.replace(/\u00a0/g, " ");
  if (!/bytes\/(?:sek|sec)/i.test(normalized)) return null;
  const match = /(?:geschwindigkeit|speed)\s*:\s*([\d\s.,]+)\s*bytes\/(?:sek|sec)/i.exec(normalized);
  if (!match) return null;
  const digits = match[1].replace(/[^\d]/g, "");
  if (!digits) return null;
  const speed = Number(digits);
  return speed > 0 ? speed : null;
}

function validateRoots(config) {
  const missing = [expandHome(config.movies_root), expandHome(config.series_root)].filter((root) => !fs.existsSync(root));
  if (missing.length) {
    throw new Error(`Folgende Zielpfade fehlen oder das Netzlaufwerk ist nicht verbunden:\n${missing.join("\n")}`);
  }
}

function pendingJobPayload(jobs) {
  return jobs
      .filter((job) => !["Kopiert", "Uebersprungen", "Übersprungen"].includes(job.status))
    .map((job) => ({
      source: job.source,
      target: job.target,
      media_type: job.media_type,
      size_bytes: job.size_bytes || 0,
      size_label: job.size_label || "-"
    }));
}

function updatePendingJobs(jobs) {
  const config = loadConfig();
  config.pending_jobs = config.remember_pending_jobs ? pendingJobPayload(jobs || []) : [];
  saveConfig(config);
  return config;
}

async function runSingleJob(job, config) {
  send("copy:job-start", { id: job.id });
  send("copy:job-update", { id: job.id, status: "Kopiert...", progress: "0%" });
  appendLog(`Starte Job #${job.id}: ${job.source} -> ${job.target}`, false);

  try {
    const targetDir = job.media_type === "Film" && path.extname(job.target) ? path.dirname(job.target) : job.target;
    ensureDir(targetDir);
    const { command, args } = buildRobocopyCommand(job, config);
    appendLog(`robocopy ${args.join(" ")}`, false);

    await new Promise((resolve) => {
      const child = spawn(command, args, { windowsHide: true });
      activeProcesses.add(child);
      let lastProgress = "0%";
      let stdoutBuffer = "";

      const consumeLine = (rawLine) => {
        const cleaned = rawLine.trimEnd();
        if (!cleaned) return;
        const isError = /error|fehler/i.test(cleaned);
        appendLog(`Job #${job.id}: ${cleaned}`, isError);
        const progress = extractProgress(cleaned);
        if (progress && progress !== lastProgress) {
          lastProgress = progress;
          send("copy:job-update", { id: job.id, status: "Kopiert...", progress });
        }
        const speed = extractSpeed(cleaned);
        if (speed) send("copy:job-speed", { id: job.id, speed });
      };

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        lines.forEach(consumeLine);
      });
      child.stderr.on("data", (chunk) => {
        chunk.toString("utf8").split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(`Job #${job.id}: ${line}`, true));
      });
      child.on("error", (error) => {
        send("copy:job-update", { id: job.id, status: "Fehler", progress: "-" });
        appendLog(`Job #${job.id} abgebrochen: ${error.message}`, true);
        activeProcesses.delete(child);
        resolve();
      });
      child.on("close", (code) => {
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
        activeProcesses.delete(child);
        const returnCode = Number(code || 0);
        if (returnCode < 8) {
          if (returnCode === 0) {
            send("copy:job-update", { id: job.id, status: "Übersprungen", progress: lastProgress, return_code: returnCode });
            appendLog(`Job #${job.id} ohne Änderungen beendet (Code 0).`, false);
          } else {
            send("copy:job-update", { id: job.id, status: "Kopiert", progress: "100%", return_code: returnCode });
            appendLog(`Job #${job.id} erfolgreich abgeschlossen (Code ${returnCode}).`, false);
          }
        } else {
          send("copy:job-update", { id: job.id, status: `Fehler (${returnCode})`, progress: lastProgress, return_code: returnCode });
          appendLog(`Job #${job.id} fehlgeschlagen (Code ${returnCode}).`, true);
        }
        send("copy:job-speed", { id: job.id, speed: 0 });
        send("copy:job-done", { id: job.id });
        resolve();
      });
    });
  } catch (error) {
    send("copy:job-update", { id: job.id, status: "Fehler", progress: "-" });
    appendLog(`Job #${job.id} abgebrochen: ${error.message}`, true);
    send("copy:job-speed", { id: job.id, speed: 0 });
    send("copy:job-done", { id: job.id });
  }
}

async function runPool(jobs, config) {
  const queue = jobs.slice();
  const workerCount = config.parallel_enabled ? 2 : 1;
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const job = queue.shift();
      if (job) await runSingleJob(job, config);
    }
  });
  await Promise.all(workers);
}

function triggerPlexRefresh(config, libraries) {
  const baseUrl = String(config.plex_url || "").replace(/\/+$/, "");
  const token = String(config.plex_token || "").trim();
  if (!baseUrl || !token) return Promise.resolve({ movies_ok: false, series_ok: false });

  const targetLibraries = new Set(libraries && libraries.length ? libraries : ["Film", "Serie"]);
  const refresh = (sectionId) => new Promise((resolve) => {
    if (!sectionId) {
      resolve(false);
      return;
    }
    const refreshUrl = new URL(`${baseUrl}/library/sections/${sectionId}/refresh`);
    refreshUrl.searchParams.set("X-Plex-Token", token);
    const client = refreshUrl.protocol === "https:" ? https : http;
    const req = client.request(refreshUrl, { method: "GET", timeout: 10000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on("timeout", () => {
      req.destroy(new Error("Timeout"));
    });
    req.on("error", (error) => {
      appendLog(`Plex-Refresh für Section ${sectionId} fehlgeschlagen: ${error.message}`, true);
      resolve(false);
    });
    req.end();
  });

  return Promise.all([
    targetLibraries.has("Film") ? refresh(String(config.movies_section_id || "").trim()) : false,
    targetLibraries.has("Serie") ? refresh(String(config.series_section_id || "").trim()) : false
  ]).then(([moviesOk, seriesOk]) => ({ movies_ok: moviesOk, series_ok: seriesOk }));
}

async function startCopy(jobs) {
  if (running || speedTestRunning) throw new Error("Es läuft bereits ein Kopiervorgang.");
  if (!jobs || !jobs.length) throw new Error("Es sind keine Jobs vorhanden.");
  const config = loadConfig();
  validateRoots(config);

  const copyJobs = jobs.filter((job) => !["Kopiert", "Uebersprungen", "Übersprungen"].includes(job.status));
  if (!copyJobs.length) throw new Error("Es gibt keine offenen Jobs.");

  running = true;
  currentLogPath = path.join(logsDir(), `run_${nowStamp()}.log`);
  ensureDir(logsDir());
  appendLog("Kopiervorgang gestartet.", false);
  send("copy:started", { logPath: currentLogPath });

  const startedAt = Date.now();
  await runPool(copyJobs, config);
  const duration = Math.max((Date.now() - startedAt) / 1000, 0.001);
  running = false;
  activeProcesses.clear();

  send("copy:all-done", {});
  appendLog("Kopiervorgang abgeschlossen.", false);
  const latestJobs = await mainWindow.webContents.executeJavaScript("window.__plexTransferGetJobsForMain && window.__plexTransferGetJobsForMain()", true).catch(() => jobs);
  const success = latestJobs.filter((job) => job.status === "Kopiert").length;
  const skipped = latestJobs.filter((job) => ["Uebersprungen", "Übersprungen"].includes(job.status)).length;
  const failed = latestJobs.filter((job) => String(job.status || "").startsWith("Fehler")).length;
  const copiedBytes = latestJobs.filter((job) => job.status === "Kopiert").reduce((sum, job) => sum + Number(job.size_bytes || 0), 0);

  if (copiedBytes > 0) {
    config.last_measured_bytes_per_sec = copiedBytes / duration;
    config.last_measured_at = isoLocal();
    config.last_measured_source = "run";
    saveConfig(config);
    appendLog(`Gemessene Transfergeschwindigkeit gespeichert: ${formatSize(config.last_measured_bytes_per_sec)}/s.`, false);
  }
  updatePendingJobs(latestJobs);

  if (config.auto_refresh && success > 0) {
    const libraries = [...new Set(latestJobs.filter((job) => job.status === "Kopiert").map((job) => job.media_type))];
    const result = await triggerPlexRefresh(config, libraries);
    appendLog(result.movies_ok || result.series_ok ? "Automatischer Plex-Refresh erfolgreich ausgelöst." : "Automatischer Plex-Refresh konnte nicht ausgelöst werden.", !(result.movies_ok || result.series_ok));
  }

  send("copy:finished", { success, skipped, failed });
  currentLogPath = null;
}

async function runSpeedTest() {
  if (running || speedTestRunning) throw new Error("Es läuft bereits ein Vorgang.");
  const config = loadConfig();
  validateRoots(config);
  const probeRoot = [config.movies_root, config.series_root].map(expandHome).find((root) => fs.existsSync(root));
  if (!probeRoot) throw new Error("Kein erreichbares Ziel für den Geschwindigkeitstest gefunden.");

  speedTestRunning = true;
  const localDir = tmpProbeDir();
  const targetDir = path.join(probeRoot, "_PlexTransferSpeedProbe");
  const sourceFile = path.join(localDir, "plex_transfer_probe_1gb.bin");
  ensureDir(localDir);
  ensureDir(targetDir);
  fs.closeSync(fs.openSync(sourceFile, "w"));
  fs.truncateSync(sourceFile, PROBE_SIZE);
  appendLog("Starte 1-GB-Geschwindigkeitstest.", false);

  const startedAt = Date.now();
  const result = await new Promise((resolve, reject) => {
    const args = [localDir, targetDir, path.basename(sourceFile), ...robocopyFlags(config)];
    const child = spawn("robocopy", args, { windowsHide: true });
    activeProcesses.add(child);
    child.stdout.on("data", (chunk) => {
      chunk.toString("utf8").split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(`Speed-Test: ${line}`, /error|fehler/i.test(line)));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      activeProcesses.delete(child);
      Number(code || 0) >= 8 ? reject(new Error(`robocopy fehlgeschlagen (Code ${code})`)) : resolve();
    });
  }).then(() => {
    const duration = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const bytesPerSec = PROBE_SIZE / duration;
    config.last_measured_bytes_per_sec = bytesPerSec;
    config.last_measured_at = isoLocal();
    config.last_measured_source = "speed_test";
    saveConfig(config);
    return { bytes_per_sec: bytesPerSec, duration };
  }).finally(() => {
    speedTestRunning = false;
    for (const cleanupPath of [sourceFile, path.join(targetDir, path.basename(sourceFile))]) {
      try {
        if (fs.existsSync(cleanupPath)) fs.unlinkSync(cleanupPath);
      } catch {}
    }
    for (const cleanupDir of [targetDir, localDir]) {
      try {
        if (fs.existsSync(cleanupDir)) fs.rmdirSync(cleanupDir);
      } catch {}
    }
  });

  appendLog(`Geschwindigkeitstest abgeschlossen: ${formatSize(result.bytes_per_sec)}/s.`, false);
  return result;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: "#171b22",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("config:get", () => loadConfig());
ipcMain.handle("config:save", (_event, config) => {
  saveConfig(config);
  return loadConfig();
});
ipcMain.handle("jobs:create", (_event, paths, forcedType) => {
  const jobs = [];
  const errors = [];
  for (const item of paths || []) {
    try {
      jobs.push(buildJob(item, forcedType));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { jobs, errors };
});
ipcMain.handle("jobs:savePending", (_event, jobs) => updatePendingJobs(jobs));
ipcMain.handle("storage:targets", (_event, jobs) => targetStorageSummary(jobs));
ipcMain.handle("copy:start", (_event, jobs) => {
  startCopy(jobs).catch((error) => {
    running = false;
    send("copy:error", { message: error.message });
  });
  return { ok: true };
});
ipcMain.handle("copy:cancel", () => {
  for (const child of activeProcesses) {
    try {
      child.kill();
    } catch {}
  }
  running = false;
  speedTestRunning = false;
  appendLog("Vorgang abgebrochen.", true);
  return { ok: true };
});
ipcMain.handle("dialog:movie", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Film auswählen",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Videodateien", extensions: [...VIDEO_EXTENSIONS].map((ext) => ext.slice(1)) },
      { name: "Alle Dateien", extensions: ["*"] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("dialog:series", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Serienordner auswählen",
    properties: ["openDirectory", "multiSelections"]
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("dialog:any", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Mehrere Medien auswählen",
    properties: ["openFile", "openDirectory", "multiSelections"],
    filters: [
      { name: "Videodateien", extensions: [...VIDEO_EXTENSIONS].map((ext) => ext.slice(1)) },
      { name: "Alle Dateien", extensions: ["*"] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("logs:open", async () => {
  ensureDir(logsDir());
  await shell.openPath(logsDir());
  return logsDir();
});
ipcMain.handle("path:open", (_event, rawPath) => openPathSmart(rawPath));
ipcMain.handle("path:copy", (_event, rawPath) => {
  clipboard.writeText(String(rawPath || ""));
  return { ok: true };
});
ipcMain.handle("plex:refresh", async (_event, libraries) => triggerPlexRefresh(loadConfig(), libraries));
ipcMain.handle("speed:test", () => runSpeedTest());
