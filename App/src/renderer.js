const api = window.plexTransfer || {
  getConfig: async () => ({
    movies_root: "T:\\TO-MOONDOOM\\Movies",
    series_root: "T:\\TO-MOONDOOM\\Series",
    plex_url: "",
    plex_token: "",
    movies_section_id: "",
    series_section_id: "",
    parallel_enabled: false,
    auto_refresh: true,
    refresh_after_transfer: true,
    refresh_after_rename: true,
    refresh_after_combo: true,
    rename_folder_structure_mode: "plex",
    tmdb_access_token: "",
    tmdb_language: "de-DE",
    tmdb_region: "DE",
    metadata_provider: "tmdb",
    theme_mode: "dunkel",
    remember_pending_jobs: true,
    pending_jobs: [],
    last_measured_bytes_per_sec: 115583665,
    last_measured_at: "2026-05-01T23:48:16",
    last_measured_source: "run"
  }),
  saveConfig: async (config) => config,
  createJobs: async (paths, forcedType) => ({
    jobs: (paths || []).map((item) => ({
      source: item,
      target: `${forcedType === "Serie" ? "T:\\TO-MOONDOOM\\Series" : "T:\\TO-MOONDOOM\\Movies"}\\${String(item).split(/[\\/]/).pop()}`,
      media_type: forcedType || "Film",
      status: "Bereit",
      progress: "-",
      live_speed_bytes_per_sec: 0,
      size_bytes: 734003200,
      size_label: "700 MB",
      return_code: null
    })),
    errors: []
  }),
  savePendingJobs: async () => api.getConfig(),
  getTargetStorage: async (jobs) => [{
    root: "T:\\TO-MOONDOOM\\Movies",
    planned_bytes: (jobs || []).reduce((sum, job) => sum + Number(job.size_bytes || 0), 0),
    exists: true,
    free_bytes: 858993459200,
    after_bytes: 858993459200 - (jobs || []).reduce((sum, job) => sum + Number(job.size_bytes || 0), 0),
    ok: true,
    error: ""
  }],
  startCopy: async () => ({ ok: true }),
  cancelCopy: async () => ({ ok: true }),
  selectRenameFiles: async () => ["D:\\Demo\\Example.Movie.2026.1080p.mkv"],
  selectRenameFolders: async () => ["D:\\Demo\\Example.Show"],
  selectMovies: async () => ["D:\\Demo\\Example.Movie.2026.1080p.mkv"],
  selectSeries: async () => ["D:\\Demo\\Example.Show\\Example.Show.S01E01.mkv"],
  selectAny: async () => ["D:\\Demo\\Example.Movie.2026.1080p.mkv", "D:\\Demo\\Example.Show\\Example.Show.S01E01.mkv"],
  openLogs: async () => "",
  openPath: async () => "",
  copyPath: async () => ({ ok: true }),
  refreshPlex: async () => ({ movies_ok: true, series_ok: true }),
  runSpeedTest: async () => ({ bytes_per_sec: 115583665, duration: 9 }),
  previewRename: async (paths) => ({
    jobs: (paths || []).map((item) => ({
      source: item,
      target: String(item).replace(/(\.[^.]+)$/, " - Vorschau$1"),
      media_type: "Film",
      status: "Bereit",
      size_label: "700 MB",
      warning: ""
    })),
    errors: []
  }),
  startRename: async (jobs) => ({ jobs: (jobs || []).map((job) => ({ ...job, final_path: job.target, status: "Umbenannt" })), success: (jobs || []).length, failed: 0 }),
  applyMetadataToRenameJob: async (job, metadata) => ({ ...job, metadata_source: "tmdb", metadata_confirmed: true, tmdb_title: metadata.title || "" }),
  searchMetadata: async () => ({ results: [] }),
  getMetadataDetails: async (_id, mediaType) => ({ id: _id, media_type: mediaType, title: "Demo", overview: "" }),
  getEpisodeMetadata: async () => ({ title: "Episode", overview: "" }),
  getSeasonMetadata: async (_id, season) => ({ season, episodes: [{ episode: 1, title: "Episode" }] }),
  testMetadataConfig: async () => ({ ok: true }),
  setWorkflowMode: async () => ({ ok: true }),
  onCopyStarted: () => () => {},
  onCopyLog: () => () => {},
  onCopyJobStart: () => () => {},
  onCopyJobUpdate: () => () => {},
  onCopyJobSpeed: () => () => {},
  onCopyJobDone: () => () => {},
  onCopyAllDone: () => () => {},
  onCopyFinished: () => () => {},
  onCopyError: () => () => {}
};

const state = {
  config: null,
  jobs: [],
  selectedJobId: null,
  nextJobId: 1,
  running: false,
  speedTestRunning: false,
  workflowMode: "picker",
  activeJobIds: new Set(),
  renamePaths: [],
  renameJobs: [],
  comboPaths: [],
  comboJobs: [],
  logEntries: [],
  storageWarnings: [],
  storageRequestId: 0
};

const $ = (id) => document.getElementById(id);

const els = {
  app: $("app"),
  workflowPicker: $("workflowPicker"),
  workflowBackButton: $("workflowBackButton"),
  mainView: $("mainView"),
  renameView: $("renameView"),
  comboView: $("comboView"),
  settingsView: $("settingsView"),
  settingsButton: $("settingsButton"),
  statusBadge: $("statusBadge"),
  statusDetail: $("statusDetail"),
  movieButton: $("movieButton"),
  seriesButton: $("seriesButton"),
  multiButton: $("multiButton"),
  startButton: $("startButton"),
  cancelButton: $("cancelButton"),
  plexButton: $("plexButton"),
  logsButton: $("logsButton"),
  speedButton: $("speedButton"),
  dropZone: $("dropZone"),
  jobsBody: $("jobsBody"),
  emptyJobs: $("emptyJobs"),
  jobMeta: $("jobMeta"),
  jobStatusLine: $("jobStatusLine"),
  jobSearchInput: $("jobSearchInput"),
  moveUpButton: $("moveUpButton"),
  moveDownButton: $("moveDownButton"),
  removeButton: $("removeButton"),
  retryButton: $("retryButton"),
  clearButton: $("clearButton"),
  errorsOnlyToggle: $("errorsOnlyToggle"),
  logBox: $("logBox"),
  etaTitle: $("etaTitle"),
  etaDetail: $("etaDetail"),
  activeRows: $("activeRows"),
  overallProgress: $("overallProgress"),
  overallProgressText: $("overallProgressText"),
  summary: $("summary"),
  lastAction: $("lastAction"),
  transferSize: $("transferSize"),
  targetSpace: $("targetSpace"),
  modalHost: $("modalHost"),
  contextMenu: $("contextMenu"),
  toastHost: $("toastHost"),
  moviesRootInput: $("moviesRootInput"),
  seriesRootInput: $("seriesRootInput"),
  plexUrlInput: $("plexUrlInput"),
  plexTokenInput: $("plexTokenInput"),
  moviesSectionInput: $("moviesSectionInput"),
  seriesSectionInput: $("seriesSectionInput"),
  parallelInput: $("parallelInput"),
  autoRefreshInput: $("autoRefreshInput"),
  renameRefreshSettingsInput: $("renameRefreshSettingsInput"),
  comboRefreshSettingsInput: $("comboRefreshSettingsInput"),
  renameStructureSettingsInput: $("renameStructureSettingsInput"),
  tmdbTokenInput: $("tmdbTokenInput"),
  tmdbLanguageInput: $("tmdbLanguageInput"),
  tmdbRegionInput: $("tmdbRegionInput"),
  tmdbTestButton: $("tmdbTestButton"),
  tmdbStatusText: $("tmdbStatusText"),
  rememberInput: $("rememberInput"),
  themeInput: $("themeInput"),
  saveSettingsButton: $("saveSettingsButton"),
  cancelSettingsButton: $("cancelSettingsButton"),
  plexieMascot: $("plexieMascot"),
  renamePickButton: $("renamePickButton"),
  renameFolderButton: $("renameFolderButton"),
  renameSearchButton: $("renameSearchButton"),
  renameTypeInput: $("renameTypeInput"),
  renameStructureInput: $("renameStructureInput"),
  renameShowInput: $("renameShowInput"),
  renameYearInput: $("renameYearInput"),
  renameRefreshInput: $("renameRefreshInput"),
  renamePreviewButton: $("renamePreviewButton"),
  renameStartButton: $("renameStartButton"),
  renameClearButton: $("renameClearButton"),
  renamePreviewList: $("renamePreviewList"),
  comboPickButton: $("comboPickButton"),
  comboFolderButton: $("comboFolderButton"),
  comboSearchButton: $("comboSearchButton"),
  comboTypeInput: $("comboTypeInput"),
  comboStructureInput: $("comboStructureInput"),
  comboShowInput: $("comboShowInput"),
  comboYearInput: $("comboYearInput"),
  comboRefreshInput: $("comboRefreshInput"),
  comboPreviewButton: $("comboPreviewButton"),
  comboStartButton: $("comboStartButton"),
  comboClearButton: $("comboClearButton"),
  comboPreviewList: $("comboPreviewList")
};

window.__plexTransferGetJobsForMain = () => state.jobs;

function setText(element, value) {
  element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanErrorMessage(error) {
  return String(error?.message || error || "Unbekannter Fehler")
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, "")
    .replace(/^Error:\s*/i, "");
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

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "-";
  return `${formatSize(bytesPerSec)}/s`;
}

function formatEta(secondsTotal) {
  if (!secondsTotal || secondsTotal <= 0) return "unter 1 Min";
  const minutes = Math.round(secondsTotal / 60);
  if (minutes <= 1) return "ca. 1 Min";
  if (minutes < 60) return `ca. ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `ca. ${hours} Std` : `ca. ${hours} Std ${rem} Min`;
}

function normalizeStatus(status) {
  return status === "Uebersprungen" ? "Übersprungen" : String(status || "");
}

function isSkipped(job) {
  return ["Uebersprungen", "Übersprungen"].includes(job.status);
}

function isFailed(job) {
  return String(job.status || "").startsWith("Fehler");
}

function isComplete(job) {
  return job.status === "Kopiert" || isSkipped(job) || isFailed(job);
}

function isOpenJob(job) {
  return !isComplete(job);
}

function progressToFraction(progress) {
  const match = String(progress || "").match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!match) return 0;
  return Math.max(0, Math.min(1, Number(match[1]) / 100));
}

function shortPath(value, max = 78) {
  const raw = String(value || "");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, 30)}...${raw.slice(-(max - 33))}`;
}

function basename(value) {
  return String(value || "").split(/[\\/]/).pop() || value || "-";
}

function setGlobalStatus(title, detail) {
  setText(els.statusBadge, title);
  setText(els.statusDetail, detail);
  const danger = title === "Fehler";
  const good = title === "Fertig";
  const active = title === "Kopiert...";
  els.statusBadge.style.background = danger ? "var(--danger)" : good ? "var(--success)" : active ? "var(--primary)" : "var(--primary-soft)";
  els.statusBadge.style.color = danger || good || active ? "#fff" : "var(--text)";
  if (state.speedTestRunning) return;
  if (danger) setMascotState("warning");
  else if (good) setMascotState("sleeping");
  else if (active) setMascotState("busy");
  else setMascotState("idle");
}

function setMascotState(stateName) {
  if (!els.plexieMascot) return;
  els.plexieMascot.className = `mascot ${stateName}`;
}

function restingMascotState() {
  if (state.speedTestRunning) return "speeding";
  if (state.running) return "busy";
  if (state.jobs.some(isFailed)) return "warning";
  return "idle";
}

function cueMascotState(stateName, duration = 1600) {
  setMascotState(stateName);
  clearTimeout(window.__plexieCueTimer);
  window.__plexieCueTimer = setTimeout(() => setMascotState(restingMascotState()), duration);
}

function launchMascotTour(returnState = restingMascotState()) {
  if (!els.plexieMascot) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    cueMascotState("happy", 1400);
    return;
  }
  clearTimeout(window.__plexieCueTimer);
  clearTimeout(window.__plexieTourTimer);
  const rect = els.plexieMascot.getBoundingClientRect();
  const width = rect.width || 112;
  const height = rect.height || 112;
  const point = (x, y, transform) => ({
    left: `${Math.max(16, Math.min(window.innerWidth - width - 16, x - width / 2))}px`,
    top: `${Math.max(16, Math.min(window.innerHeight - height - 16, y - height / 2))}px`,
    transform
  });
  const start = point(rect.left + width / 2, rect.top + height / 2, "scale(1) rotate(0deg)");

  els.plexieMascot.className = "mascot roaming happy";
  Object.assign(els.plexieMascot.style, {
    position: "fixed",
    left: start.left,
    top: start.top,
    width: `${width}px`,
    height: `${height}px`
  });

  const flight = els.plexieMascot.animate([
    start,
    point(window.innerWidth * 0.76, window.innerHeight * 0.18, "scale(1.07) rotate(8deg)"),
    point(window.innerWidth * 0.48, window.innerHeight * 0.2, "scale(1.12) rotate(-9deg)"),
    point(window.innerWidth * 0.18, window.innerHeight * 0.42, "scale(1.05) rotate(10deg)"),
    point(window.innerWidth * 0.38, window.innerHeight * 0.68, "scale(1.13) rotate(-6deg)"),
    point(window.innerWidth * 0.72, window.innerHeight * 0.58, "scale(1.08) rotate(7deg)"),
    start
  ], {
    duration: 6200,
    easing: "cubic-bezier(0.37, 0, 0.18, 1)",
    fill: "forwards"
  });

  flight.onfinish = () => {
    els.plexieMascot.removeAttribute("style");
    setMascotState(returnState);
  };
  flight.oncancel = flight.onfinish;
  window.__plexieTourTimer = setTimeout(() => {
    flight.cancel();
  }, 7000);
}

function showToast(title, message = "", isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
  els.toastHost.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
  }, 3600);
  setTimeout(() => toast.remove(), 4200);
}

function appendLog(message, isError = false) {
  const stamp = new Date().toLocaleTimeString("de-DE", { hour12: false });
  const entry = { text: `[${stamp}] ${message}`, isError: Boolean(isError) };
  state.logEntries.push(entry);
  refreshLog();
}

function refreshLog() {
  const rows = state.logEntries.filter((entry) => !els.errorsOnlyToggle.checked || entry.isError);
  els.logBox.textContent = rows.map((entry) => entry.text).join("\n");
  els.logBox.scrollTop = els.logBox.scrollHeight;
}

function applyTheme() {
  const theme = state.config?.theme_mode === "hell" ? "hell" : "dunkel";
  els.app.classList.toggle("theme-dunkel", theme === "dunkel");
}

function showWorkflowView(mode) {
  const topbar = document.querySelector(".topbar");
  els.workflowPicker.classList.toggle("hidden", mode !== "picker");
  topbar?.classList.toggle("hidden", mode === "picker");
  els.mainView.classList.toggle("hidden", mode !== "transfer");
  els.renameView.classList.toggle("hidden", mode !== "rename");
  els.comboView.classList.toggle("hidden", mode !== "combo");
  els.settingsView.classList.add("hidden");
  els.settingsButton.disabled = mode === "picker";
}

async function setWorkflowMode(mode) {
  state.config = await api.getConfig();
  loadSettingsDraft();
  state.workflowMode = mode;
  await api.setWorkflowMode(mode);
  showWorkflowView(mode);
  const labels = { transfer: "Übertragen", rename: "Umbenennen", combo: "Beides", picker: "Plex Transfer" };
  setText($("subtitle"), mode === "combo" ? "Erst Plex-konform umbenennen, dann übertragen" : mode === "rename" ? "Lokales Plex-konformes Umbenennen" : "Lokaler Plex-/NAS-Kopierworkflow mit Robocopy");
  setGlobalStatus("Bereit", `${labels[mode] || "Workflow"} bereit.`);
}

function loadSettingsDraft() {
  els.moviesRootInput.value = state.config.movies_root || "";
  els.seriesRootInput.value = state.config.series_root || "";
  els.plexUrlInput.value = state.config.plex_url || "";
  els.plexTokenInput.value = state.config.plex_token || "";
  els.moviesSectionInput.value = state.config.movies_section_id || "";
  els.seriesSectionInput.value = state.config.series_section_id || "";
  els.parallelInput.checked = Boolean(state.config.parallel_enabled);
  els.autoRefreshInput.checked = Boolean(state.config.refresh_after_transfer ?? state.config.auto_refresh);
  els.renameRefreshSettingsInput.checked = Boolean(state.config.refresh_after_rename ?? state.config.auto_refresh);
  els.comboRefreshSettingsInput.checked = Boolean(state.config.refresh_after_combo ?? state.config.auto_refresh);
  els.renameStructureSettingsInput.value = state.config.rename_folder_structure_mode || "plex";
  els.tmdbTokenInput.value = state.config.tmdb_access_token || "";
  els.tmdbLanguageInput.value = state.config.tmdb_language || "de-DE";
  els.tmdbRegionInput.value = state.config.tmdb_region || "DE";
  setText(els.tmdbStatusText, "This product uses the TMDB API but is not endorsed or certified by TMDB.");
  els.rememberInput.checked = Boolean(state.config.remember_pending_jobs);
  els.themeInput.value = state.config.theme_mode || "hell";
  els.renameStructureInput.value = state.config.rename_folder_structure_mode || "plex";
  els.comboStructureInput.value = state.config.rename_folder_structure_mode || "plex";
  els.renameRefreshInput.checked = Boolean(state.config.refresh_after_rename ?? state.config.auto_refresh);
  els.comboRefreshInput.checked = Boolean(state.config.refresh_after_combo ?? state.config.auto_refresh);
}

function readSettingsDraft() {
  return {
    ...state.config,
    movies_root: els.moviesRootInput.value.trim(),
    series_root: els.seriesRootInput.value.trim(),
    plex_url: els.plexUrlInput.value.trim(),
    plex_token: els.plexTokenInput.value.trim(),
    movies_section_id: els.moviesSectionInput.value.trim(),
    series_section_id: els.seriesSectionInput.value.trim(),
    parallel_enabled: els.parallelInput.checked,
    auto_refresh: els.autoRefreshInput.checked,
    refresh_after_transfer: els.autoRefreshInput.checked,
    refresh_after_rename: els.renameRefreshSettingsInput.checked,
    refresh_after_combo: els.comboRefreshSettingsInput.checked,
    rename_folder_structure_mode: els.renameStructureSettingsInput.value,
    tmdb_access_token: els.tmdbTokenInput.value.trim(),
    tmdb_language: els.tmdbLanguageInput.value.trim() || "de-DE",
    tmdb_region: els.tmdbRegionInput.value.trim() || "DE",
    metadata_provider: "tmdb",
    remember_pending_jobs: els.rememberInput.checked,
    theme_mode: els.themeInput.value
  };
}

function showSettings() {
  loadSettingsDraft();
  els.mainView.classList.add("hidden");
  els.renameView.classList.add("hidden");
  els.comboView.classList.add("hidden");
  els.settingsView.classList.remove("hidden");
  els.settingsButton.disabled = true;
}

function hideSettings() {
  els.settingsView.classList.add("hidden");
  showWorkflowView(state.workflowMode);
  els.settingsButton.disabled = false;
}

async function savePendingJobs() {
  state.config = await api.savePendingJobs(state.jobs);
}

function restorePendingJobs() {
  if (!state.config.remember_pending_jobs) return;
  for (const item of state.config.pending_jobs || []) {
    if (!item || !item.source || !item.target || !["Film", "Serie"].includes(item.media_type)) continue;
    state.jobs.push({
      id: state.nextJobId++,
      source: item.source,
      target: item.target,
      media_type: item.media_type,
      status: "Bereit",
      progress: "-",
      live_speed_bytes_per_sec: 0,
      started_at: 0,
      last_progress_fraction: 0,
      last_progress_at: 0,
      size_bytes: Number(item.size_bytes || 0),
      size_label: item.size_label || formatSize(Number(item.size_bytes || 0)),
      return_code: null
    });
  }
  if (state.jobs.length) appendLog(`${state.jobs.length} offene Jobs wiederhergestellt.`);
}

function selectedIndex() {
  return state.jobs.findIndex((job) => job.id === state.selectedJobId);
}

function filteredJobs() {
  const query = els.jobSearchInput.value.trim().toLowerCase();
  if (!query) return state.jobs;
  return state.jobs.filter((job) => (
    job.media_type.toLowerCase().includes(query)
    || job.source.toLowerCase().includes(query)
    || job.target.toLowerCase().includes(query)
    || normalizeStatus(job.status).toLowerCase().includes(query)
  ));
}

function statusClass(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "Kopiert") return "status-ok";
  if (normalized === "Kopiert..." || normalized === "Wartet") return "status-warn";
  if (normalized.startsWith("Fehler")) return "status-error";
  return "";
}

function renderJobs() {
  hideContextMenu();
  els.jobsBody.innerHTML = "";
  const rows = filteredJobs();
  for (const job of rows) {
    const row = document.createElement("tr");
    row.className = job.id === state.selectedJobId ? "selected" : "";
    row.addEventListener("click", () => {
      state.selectedJobId = job.id;
      renderJobs();
    });
    row.addEventListener("dblclick", () => openJobPath(job, "source"));
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      state.selectedJobId = job.id;
      renderJobs();
      showContextMenu(job, event.clientX, event.clientY);
    });
    row.innerHTML = `
      <td>${job.media_type}</td>
      <td class="path-cell" title="${escapeHtml(job.source)}">${escapeHtml(shortPath(job.source))}</td>
      <td class="path-cell" title="${escapeHtml(job.target)}">${escapeHtml(shortPath(job.target))}</td>
      <td>${escapeHtml(job.size_label || formatSize(job.size_bytes))}</td>
      <td class="${statusClass(job.status)}">${escapeHtml(normalizeStatus(job.status))}</td>
      <td>${escapeHtml(job.progress || "-")}</td>
    `;
    els.jobsBody.appendChild(row);
  }

  els.emptyJobs.classList.toggle("hidden", state.jobs.length > 0);
  const waiting = state.jobs.filter((job) => ["Bereit", "Wartet"].includes(job.status)).length;
  const active = state.jobs.filter((job) => job.status === "Kopiert...").length;
  const failed = state.jobs.filter(isFailed).length;
  const filterNote = rows.length !== state.jobs.length ? ` · ${rows.length} sichtbar` : "";
  setText(els.jobMeta, `${state.jobs.length} Jobs in der Liste${filterNote}`);
  setText(els.jobStatusLine, `${waiting} wartend | ${active} läuft | ${failed} Fehler`);

  const index = selectedIndex();
  const hasFailed = state.jobs.some(isFailed);
  els.moveUpButton.disabled = state.running || index <= 0;
  els.moveDownButton.disabled = state.running || index < 0 || index >= state.jobs.length - 1;
  els.removeButton.disabled = state.running || index < 0;
  els.retryButton.disabled = state.running || !hasFailed;
  els.clearButton.disabled = state.running || state.jobs.length === 0;
  els.cancelButton.classList.toggle("hidden", !state.running);
  refreshStatus();
}

function refreshActiveRows() {
  els.activeRows.innerHTML = "";
  const activeJobs = state.jobs.filter((job) => state.activeJobIds.has(job.id)).slice(0, 2);
  for (const job of activeJobs) {
    const row = document.createElement("div");
    row.className = "active-row";
    row.innerHTML = `
      <div class="row-heading"><strong>${escapeHtml(shortPath(basename(job.source), 42))}</strong><span>${escapeHtml(job.progress || "0%")}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${progressToFraction(job.progress) * 100}%"></div></div>
    `;
    els.activeRows.appendChild(row);
  }
}

function currentLiveSpeed() {
  return state.jobs
    .filter((job) => state.activeJobIds.has(job.id))
    .reduce((sum, job) => sum + Math.max(Number(job.live_speed_bytes_per_sec || 0), 0), 0);
}

function remainingBytesForEta() {
  return state.jobs.reduce((sum, job) => {
    if (isComplete(job)) return sum;
    if (!job.size_bytes || job.size_bytes <= 0) return sum;
    const remainingFraction = job.status === "Kopiert..." ? Math.max(0, 1 - progressToFraction(job.progress)) : 1;
    return sum + Math.trunc(job.size_bytes * remainingFraction);
  }, 0);
}

function measurementNote() {
  const speed = Number(state.config?.last_measured_bytes_per_sec || 0);
  if (speed <= 0) return "Noch kein Messwert vorhanden.";
  const source = state.config.last_measured_source === "run" ? "letzter echter Lauf" : "1-GB-Test";
  const at = String(state.config.last_measured_at || "").replace("T", " ");
  return at ? `Basis: ${source} · ${formatSpeed(speed)} · ${at}` : `Basis: ${source} · ${formatSpeed(speed)}`;
}

function refreshEta() {
  const remaining = remainingBytesForEta();
  if (state.speedTestRunning) {
    setText(els.etaTitle, "Geschätzte Dauer: Messung läuft");
    setText(els.etaDetail, "Die NAS-Geschwindigkeit wird gerade ermittelt.");
  } else if (state.running) {
    const live = currentLiveSpeed();
    if (live > 0) {
      setText(els.etaTitle, `Aktuelle Geschwindigkeit: ${formatSpeed(live)} · Verbleibend: ${remaining > 0 ? formatEta(remaining / live) : "unter 1 Min"}`);
      setText(els.etaDetail, "Live aus Fortschritt und Robocopy-Daten berechnet.");
    } else {
      setText(els.etaTitle, "Aktuelle Geschwindigkeit: wird ermittelt · Verbleibend: wird ermittelt");
      setText(els.etaDetail, "Warte auf erste Fortschrittsdaten.");
    }
  } else if (!state.jobs.length) {
    setText(els.etaTitle, "Geschätzte Dauer: nicht verfügbar");
    setText(els.etaDetail, "Füge zuerst Jobs hinzu.");
  } else if (remaining <= 0) {
    setText(els.etaTitle, "Geschätzte Dauer: nichts offen");
    setText(els.etaDetail, "Alle aktuellen Jobs sind abgeschlossen oder übersprungen.");
  } else {
    const speed = Number(state.config?.last_measured_bytes_per_sec || 0);
    if (speed > 0) {
      setText(els.etaTitle, `Geschätzte Dauer: ${formatEta(remaining / speed)}`);
      setText(els.etaDetail, measurementNote());
    } else {
      setText(els.etaTitle, "Geschätzte Dauer: nicht verfügbar");
      setText(els.etaDetail, "Noch kein Messwert vorhanden. Nutze Geschwindigkeit testen.");
    }
  }
  els.speedButton.disabled = state.running || state.speedTestRunning;
}

function refreshStatus() {
  const total = state.jobs.length || 0;
  const success = state.jobs.filter((job) => job.status === "Kopiert").length;
  const skipped = state.jobs.filter(isSkipped).length;
  const failed = state.jobs.filter(isFailed).length;
  const completed = success + skipped + failed;
  const fraction = total ? completed / total : 0;
  els.overallProgress.style.width = `${Math.round(fraction * 100)}%`;
  setText(els.overallProgressText, `${Math.round(fraction * 100)}% abgeschlossen`);
  setText(els.summary, total ? `Erfolgreich ${success} | Übersprungen ${skipped} | Fehlgeschlagen ${failed}` : "Noch keine Kopiervorgänge gestartet.");

  const open = state.jobs.filter(isOpenJob);
  const totalSize = open.reduce((sum, job) => sum + Number(job.size_bytes || 0), 0);
  setText(els.transferSize, totalSize > 0 ? `Offene Transfers: ${formatSize(totalSize)}` : state.jobs.length ? "Offene Transfers: nichts offen" : "Offene Transfers: -");
  refreshActiveRows();
  refreshEta();
  refreshTargetStorage();
}

async function refreshTargetStorage() {
  const requestId = ++state.storageRequestId;
  const open = state.jobs.filter(isOpenJob);
  if (!open.length) {
    state.storageWarnings = [];
    setText(els.targetSpace, state.jobs.length ? "Ziel frei: nichts offen" : "-");
    return;
  }
  setText(els.targetSpace, "Speicher wird geprüft...");
  try {
    const result = await api.getTargetStorage(state.jobs);
    if (requestId !== state.storageRequestId) return;
    state.storageWarnings = (result || []).filter((item) => !item.ok);
    const lines = (result || []).map((item) => {
      if (!item.exists) return `${item.root}: nicht erreichbar`;
      if (item.free_bytes <= 0 && item.error) return `${item.root}: ${item.error}`;
      const after = item.after_bytes < 0 ? `-${formatSize(Math.abs(item.after_bytes))}` : formatSize(item.after_bytes);
      const prefix = item.ok ? "" : "Warnung: ";
      return `${prefix}${item.root}: ${formatSize(item.free_bytes)} frei, danach ${after}`;
    });
    setText(els.targetSpace, lines.length ? lines.join("\n") : "-");
  } catch (error) {
    if (requestId !== state.storageRequestId) return;
    state.storageWarnings = [{ error: error.message }];
    setText(els.targetSpace, `Speicherplatzprüfung fehlgeschlagen: ${error.message}`);
  }
}

function updateJobLiveSpeedFromProgress(job, progress) {
  if (!job.size_bytes || job.size_bytes <= 0) return;
  const fraction = progressToFraction(progress);
  if (fraction <= 0) return;
  const now = performance.now();
  if (!job.started_at) job.started_at = now;
  if (fraction >= 1) {
    const elapsed = Math.max((now - job.started_at) / 1000, 0.001);
    job.live_speed_bytes_per_sec = job.size_bytes / elapsed;
  } else if (job.last_progress_at && fraction > job.last_progress_fraction) {
    const deltaTime = (now - job.last_progress_at) / 1000;
    if (deltaTime > 0) {
      job.live_speed_bytes_per_sec = (job.size_bytes * (fraction - job.last_progress_fraction)) / deltaTime;
    }
  } else if (!job.live_speed_bytes_per_sec && job.started_at) {
    const elapsed = (now - job.started_at) / 1000;
    if (elapsed > 0) job.live_speed_bytes_per_sec = (job.size_bytes * fraction) / elapsed;
  }
  job.last_progress_fraction = Math.max(job.last_progress_fraction || 0, fraction);
  job.last_progress_at = now;
}

async function addPaths(paths, forcedType = null) {
  if (!paths || !paths.length) return;
  const result = await api.createJobs(paths, forcedType);
  const knownSources = new Set(state.jobs.map((job) => job.source.toLowerCase()));
  const knownTargets = new Set(state.jobs.map((job) => job.target.toLowerCase()));
  const duplicateMessages = [];

  for (const job of result.jobs) {
    const sourceKey = job.source.toLowerCase();
    const targetKey = job.target.toLowerCase();
    if (knownSources.has(sourceKey) || knownTargets.has(targetKey)) {
      duplicateMessages.push(`${job.media_type}: ${basename(job.source)}`);
      continue;
    }
    knownSources.add(sourceKey);
    knownTargets.add(targetKey);
    job.id = state.nextJobId++;
    job.started_at = 0;
    job.last_progress_fraction = 0;
    job.last_progress_at = 0;
    state.jobs.push(job);
    state.selectedJobId = job.id;
    appendLog(`Job hinzugefügt: ${job.media_type} | ${job.source} -> ${job.target}`);
    setText(els.lastAction, `Job hinzugefügt: ${basename(job.source)}`);
  }

  launchMascotTour("idle");

  if (duplicateMessages.length) {
    const message = `${duplicateMessages.length} Duplikat(e) wurden nicht erneut hinzugefügt.`;
    appendLog(`${message} ${duplicateMessages.join(", ")}`, true);
    showToast("Duplikatwarnung", message, true);
  }
  for (const error of result.errors || []) appendLog(error, true);
  if (result.errors?.length) showToast("Einige Pfade wurden übersprungen", `${result.errors.length} Fehler im Log.`, true);
  await savePendingJobs();
  setGlobalStatus("Bereit", "Jobliste aktualisiert.");
  renderJobs();
}

function swapJobs(from, to) {
  const temp = state.jobs[from];
  state.jobs[from] = state.jobs[to];
  state.jobs[to] = temp;
  cueMascotState("sorting", 1100);
  savePendingJobs();
  renderJobs();
}

function showModal({ title, body, buttons, small = false }) {
  return new Promise((resolve) => {
    els.modalHost.innerHTML = "";
    els.modalHost.classList.remove("hidden");
    const modal = document.createElement("div");
    modal.className = `modal${small ? " small" : ""}`;
    modal.innerHTML = `
      <div class="modal-header"><h2>${escapeHtml(title)}</h2></div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer"></div>
    `;
    const footer = modal.querySelector(".modal-footer");
    for (const button of buttons) {
      const element = document.createElement("button");
      element.textContent = button.label;
      if (button.primary) element.classList.add("primary");
      if (button.danger) element.classList.add("danger");
      element.addEventListener("click", () => {
        els.modalHost.classList.add("hidden");
        els.modalHost.innerHTML = "";
        resolve(button.value);
      });
      footer.appendChild(element);
    }
    els.modalHost.appendChild(modal);
  });
}

function showMessage(title, message, isError = false) {
  return showModal({
    title,
    body: `<p class="${isError ? "status-error" : ""}">${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
    small: true,
    buttons: [{ label: "OK", value: true, primary: true }]
  });
}

async function showCopyPreview() {
  const items = state.jobs.filter(isOpenJob).map((job) => `
    <div class="preview-item">
      <strong>${escapeHtml(job.media_type)} · ${escapeHtml(basename(job.source))}</strong>
      <span>Quelle: ${escapeHtml(job.source)}</span>
      <span>Ziel: ${escapeHtml(job.target)}</span>
    </div>
  `).join("");
  return showModal({
    title: "Zielvorschau vor dem Start",
    body: items || "<p>Keine offenen Jobs vorhanden.</p>",
    buttons: [
      { label: "Abbrechen", value: false },
      { label: "Starten", value: true, primary: true }
    ]
  });
}

async function offerSpeedTest() {
  return showModal({
    title: "Kein Messwert vorhanden",
    body: "<p>Es gibt noch keinen gemessenen Geschwindigkeitswert. Soll ein 1-GB-Testtransfer für eine bessere Zeit-Schätzung ausgeführt werden?</p>",
    small: true,
    buttons: [
      { label: "Abbrechen", value: "cancel" },
      { label: "Ohne Messung", value: "skip" },
      { label: "Test starten", value: "test", primary: true }
    ]
  });
}

async function confirmStorageWarnings() {
  await refreshTargetStorage();
  if (!state.storageWarnings.length) return true;
  const body = state.storageWarnings.map((item) => {
    const text = item.root ? `${item.root}: ${item.error || "zu wenig freier Speicher"}` : item.error;
    return `<div class="preview-item"><strong class="status-error">${escapeHtml(text)}</strong></div>`;
  }).join("");
  return showModal({
    title: "Ziel prüfen",
    body: `<p>Mindestens ein Ziel ist nicht erreichbar oder könnte zu wenig freien Speicher haben.</p>${body}`,
    small: true,
    buttons: [
      { label: "Abbrechen", value: false },
      { label: "Trotzdem starten", value: true, danger: true }
    ]
  });
}

async function startCopyFlow(skipSpeedPrompt = false, workflow = "transfer", refreshAfter = undefined) {
  if (state.running || state.speedTestRunning) {
    await showMessage("Plex Transfer", "Es läuft bereits ein Vorgang.");
    return;
  }
  if (!state.jobs.length) {
    await showMessage("Plex Transfer", "Es sind keine Jobs vorhanden.");
    return;
  }
  if (!state.jobs.some(isOpenJob)) {
    await showMessage("Plex Transfer", "Es gibt keine offenen Jobs.");
    return;
  }
  if (!(await confirmStorageWarnings())) return;
  if (!skipSpeedPrompt && Number(state.config.last_measured_bytes_per_sec || 0) <= 0) {
    const decision = await offerSpeedTest();
    if (decision === "cancel") return;
    if (decision === "test") {
      await runSpeedTestFlow(true);
      return;
    }
  }
  if (!(await showCopyPreview())) {
    setText(els.lastAction, "Kopiervorgang abgebrochen.");
    return;
  }
  state.running = true;
  state.activeJobIds.clear();
  for (const job of state.jobs) {
    if (isOpenJob(job)) {
      job.status = "Wartet";
      job.progress = "0%";
      job.live_speed_bytes_per_sec = 0;
      job.started_at = 0;
      job.last_progress_fraction = 0;
      job.last_progress_at = 0;
    }
  }
  setGlobalStatus("Kopiert...", "Kopiervorgang läuft.");
  setText(els.lastAction, "Robocopy-Worker gestartet.");
  setMascotState("busy");
  renderJobs();
  await api.startCopy(state.jobs, { workflow, refreshAfter });
}

async function cancelCopyFlow() {
  if (!state.running) return;
  const confirmed = await showModal({
    title: "Kopiervorgang abbrechen",
    body: "<p>Der laufende Robocopy-Prozess wird beendet. Bereits kopierte Dateien bleiben erhalten.</p>",
    small: true,
    buttons: [
      { label: "Weiterlaufen lassen", value: false },
      { label: "Abbrechen", value: true, danger: true }
    ]
  });
  if (!confirmed) return;
  await api.cancelCopy();
  state.running = false;
  state.activeJobIds.clear();
  for (const job of state.jobs) {
    if (["Wartet", "Kopiert..."].includes(job.status)) {
      job.status = "Fehler (abgebrochen)";
      job.progress = job.progress || "-";
    }
  }
  appendLog("Kopiervorgang wurde abgebrochen.", true);
  setGlobalStatus("Fehler", "Kopiervorgang abgebrochen.");
  setMascotState("warning");
  setTimeout(() => setMascotState("idle"), 3000);
  showToast("Kopiervorgang abgebrochen", "Offene Jobs können erneut gestartet werden.", true);
  await savePendingJobs();
  renderJobs();
}

async function runSpeedTestFlow(autoContinue = false) {
  state.speedTestRunning = true;
  let speedTestSucceeded = false;
  setText(els.lastAction, "Geschwindigkeitstest gestartet.");
  setMascotState("speeding");
  refreshEta();
  try {
    const result = await api.runSpeedTest();
    speedTestSucceeded = true;
    state.config = await api.getConfig();
    appendLog(`Geschwindigkeitstest abgeschlossen: ${formatSpeed(result.bytes_per_sec)}.`);
    setText(els.lastAction, "Geschwindigkeitstest abgeschlossen.");
    launchMascotTour(autoContinue ? "busy" : "idle");
    showToast("Geschwindigkeitstest fertig", formatSpeed(result.bytes_per_sec));
    if (autoContinue) {
      const isCombo = state.workflowMode === "combo";
      await startCopyFlow(true, isCombo ? "combo" : "transfer", isCombo ? els.comboRefreshInput.checked : undefined);
    }
  } catch (error) {
    appendLog(`Geschwindigkeitstest fehlgeschlagen: ${error.message}`, true);
    setMascotState("warning");
    await showMessage("Geschwindigkeitstest fehlgeschlagen", error.message, true);
  } finally {
    state.speedTestRunning = false;
    refreshEta();
    if (!autoContinue && !speedTestSucceeded) {
      setTimeout(() => setMascotState("warning"), 1800);
    }
  }
}

function hideContextMenu() {
  els.contextMenu.classList.add("hidden");
  els.contextMenu.innerHTML = "";
}

function showContextMenu(job, x, y) {
  const items = [
    ["Quelle öffnen", () => openJobPath(job, "source")],
    ["Ziel öffnen", () => openJobPath(job, "target")],
    ["Quellpfad kopieren", () => copyJobPath(job)],
    ["Nach oben", () => { const i = selectedIndex(); if (i > 0) swapJobs(i, i - 1); }],
    ["Nach unten", () => { const i = selectedIndex(); if (i >= 0 && i < state.jobs.length - 1) swapJobs(i, i + 1); }],
    ["Entfernen", () => removeSelectedJob()]
  ];
  els.contextMenu.innerHTML = "";
  for (const [label, handler] of items) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      hideContextMenu();
      handler();
    });
    els.contextMenu.appendChild(button);
  }
  els.contextMenu.style.left = `${Math.min(x, window.innerWidth - 230)}px`;
  els.contextMenu.style.top = `${Math.min(y, window.innerHeight - 230)}px`;
  els.contextMenu.classList.remove("hidden");
}

async function openJobPath(job, which) {
  try {
    const rawPath = which === "target" ? job.target : job.source;
    await api.openPath(rawPath);
    setText(els.lastAction, `${which === "target" ? "Ziel" : "Quelle"} geöffnet: ${basename(rawPath)}`);
  } catch (error) {
    appendLog(error.message, true);
    showToast("Pfad nicht erreichbar", error.message, true);
  }
}

async function copyJobPath(job) {
  await api.copyPath(job.source);
  setText(els.lastAction, "Quellpfad in die Zwischenablage kopiert.");
  showToast("Pfad kopiert", basename(job.source));
}

async function removeSelectedJob() {
  const index = selectedIndex();
  if (index < 0 || state.running) return;
  const [removed] = state.jobs.splice(index, 1);
  state.selectedJobId = state.jobs[Math.min(index, state.jobs.length - 1)]?.id || null;
  appendLog(`Job entfernt: ${removed.source}`);
  cueMascotState("sorting", 1100);
  await savePendingJobs();
  renderJobs();
}

async function retryFailedJobs() {
  let count = 0;
  for (const job of state.jobs) {
    if (!isFailed(job)) continue;
    job.status = "Bereit";
    job.progress = "-";
    job.return_code = null;
    job.live_speed_bytes_per_sec = 0;
    count += 1;
  }
  if (!count) return;
  appendLog(`${count} fehlgeschlagene Jobs erneut bereitgestellt.`);
  cueMascotState("happy", 1400);
  showToast("Retry vorbereitet", `${count} Jobs sind wieder bereit.`);
  await savePendingJobs();
  renderJobs();
}

function renameOptions(kind) {
  const prefix = kind === "combo" ? "combo" : "rename";
  return {
    mediaType: els[`${prefix}TypeInput`].value,
    structureMode: els[`${prefix}StructureInput`].value,
    showName: els[`${prefix}ShowInput`].value.trim(),
    movieYear: els[`${prefix}YearInput`].value.trim()
  };
}

function renderRenamePreview(kind) {
  const jobs = kind === "combo" ? state.comboJobs : state.renameJobs;
  const list = kind === "combo" ? els.comboPreviewList : els.renamePreviewList;
  if (!jobs.length) {
    list.innerHTML = `<div class="empty-tool-state">Noch keine Vorschau. Wähle Dateien oder Ordner aus.</div>`;
    return;
  }
  list.innerHTML = jobs.map((job, index) => `
    <div class="rename-preview-item ${job.status === "Fehler" ? "error" : ""}">
      <div class="preview-index">${index + 1}</div>
      <div>
        <strong>${escapeHtml(job.label || basename(job.target))}</strong>
        <span>Quelle: ${escapeHtml(job.source)}</span>
        <span>Ziel: ${escapeHtml(job.target)}</span>
        <span>Plex Config: ${escapeHtml(job.media_type === "Film" ? job.plex_movies_root || state.config.movies_root || "-" : job.plex_series_root || state.config.series_root || "-")}</span>
        ${job.metadata_confirmed ? `<em class="metadata-ok">TMDb übernommen: ${escapeHtml(job.tmdb_title || job.tmdb_episode_title || "bestätigt")}</em>` : ""}
        ${job.warning ? `<em>${escapeHtml(job.warning)}</em>` : ""}
        ${job.error ? `<em class="status-error">${escapeHtml(job.error)}</em>` : ""}
      </div>
      <div class="preview-side-actions">
        <small>${escapeHtml(job.media_type || "-")} | ${escapeHtml(job.status || "Bereit")}</small>
        <button class="metadata-search-button" data-kind="${kind}" data-index="${index}">Online suchen</button>
      </div>
    </div>
  `).join("");
  list.querySelectorAll(".metadata-search-button").forEach((button) => {
    button.addEventListener("click", () => searchMetadataForJob(button.dataset.kind, Number(button.dataset.index)));
  });
}

async function refreshRenamePreview(kind) {
  state.config = await api.getConfig();
  loadSettingsDraft();
  const paths = kind === "combo" ? state.comboPaths : state.renamePaths;
  if (!paths.length) {
    await showMessage("Umbenennen", "Bitte zuerst Dateien oder Ordner auswählen.");
    return;
  }
  const result = await api.previewRename(paths, renameOptions(kind));
  if (kind === "combo") state.comboJobs = result.jobs || [];
  else state.renameJobs = result.jobs || [];
  for (const error of result.errors || []) appendLog(error, true);
  renderRenamePreview(kind);
  setGlobalStatus("Bereit", `${(result.jobs || []).length} Vorschläge erstellt.`);
}

function metadataSearchQuery(job) {
  if (job.media_type === "Serie") {
    const label = String(job.label || basename(job.source));
    return label.replace(/\s*S\d{2}E\d{2}.*$/i, "").trim() || basename(job.source);
  }
  return String(job.label || basename(job.source)).replace(/\s*\(\d{4}\)\s*$/g, "").trim();
}

function metadataContext(job) {
  return {
    year: job.year || job.tmdb_year || "",
    season: job.season || null,
    episode: job.episode || null
  };
}

function jobListForKind(kind) {
  return kind === "combo" ? state.comboJobs : state.renameJobs;
}

function replaceJobForKind(kind, index, job) {
  if (kind === "combo") state.comboJobs[index] = job;
  else state.renameJobs[index] = job;
  renderRenamePreview(kind);
}

async function metadataDetailsHtml(result, job) {
  try {
    const details = await api.getMetadataDetails(result.id, result.media_type);
    let episodeText = "";
    if (result.media_type === "Serie" && job.season && job.episode) {
      const episode = await api.getEpisodeMetadata(result.id, job.season, job.episode).catch(() => null);
      if (episode) episodeText = `<div class="metadata-detail-block"><strong>Episode</strong><span>S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")} - ${escapeHtml(episode.title)}</span><p>${escapeHtml(episode.overview || "")}</p></div>`;
    }
    return `
        <div class="metadata-detail">
          ${details.poster_url ? `<img src="${escapeHtml(details.poster_url)}" alt="">` : ""}
          <div>
            <h3>${escapeHtml(details.title)}${details.year ? ` (${escapeHtml(details.year)})` : ""}</h3>
            <p>${escapeHtml(details.overview || "Keine Beschreibung vorhanden.")}</p>
            <span>Original: ${escapeHtml(details.original_title || "-")}</span>
            <span>TMDb ID: ${escapeHtml(details.id)}</span>
          </div>
        </div>
        ${episodeText}
      `;
  } catch (error) {
    return `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

async function acceptMetadataResult(kind, index, result) {
  const jobs = jobListForKind(kind);
  const job = jobs[index];
  if (!job) return;
  let metadata = { ...result };
  const selectedSeason = Number(result.season || result.selected_season || job.season || 0);
  const selectedEpisode = Number(result.episode || result.selected_episode || job.episode || 0);
  if (result.media_type === "Serie" && selectedSeason && selectedEpisode) {
    const episode = result.episode_title || result.tmdb_episode_title
      ? { title: result.episode_title || result.tmdb_episode_title }
      : await api.getEpisodeMetadata(result.id, selectedSeason, selectedEpisode).catch(() => null);
    if (episode) metadata = { ...metadata, episode_title: episode.title, tmdb_episode_title: episode.title };
    metadata = { ...metadata, season: selectedSeason, episode: selectedEpisode };
  }
  const updated = await api.applyMetadataToRenameJob(job, metadata);
  replaceJobForKind(kind, index, updated);
  setGlobalStatus("Bereit", "TMDb Treffer übernommen.");
  showToast("TMDb übernommen", updated.label || result.title);
}

async function showEpisodeChooser(modal, result, onSelect) {
  const slot = modal.querySelector(".metadata-detail-slot");
  if (!slot) return;
  slot.innerHTML = `<div class="metadata-detail-block"><strong>Staffeln werden geladen...</strong></div>`;
  try {
    const details = await api.getMetadataDetails(result.id, "Serie");
    const seasons = (details.seasons || []).filter((season) => Number(season.season_number) > 0);
    if (!seasons.length) {
      slot.innerHTML = `<p class="status-error">Keine Staffeln bei TMDb gefunden.</p>`;
      return;
    }
    slot.innerHTML = `
      <div class="episode-chooser">
        <div>
          <strong>${escapeHtml(details.title || result.title)}</strong>
          <span>Wähle Staffel und Folge aus TMDb.</span>
        </div>
        <div class="episode-picker-row">
          <label>Staffel
            <select data-role="season-select">
              ${seasons.map((season) => `<option value="${escapeHtml(season.season_number)}">${escapeHtml(season.name || `Staffel ${season.season_number}`)} (${escapeHtml(season.episode_count || 0)} Folgen)</option>`).join("")}
            </select>
          </label>
          <label>Folge
            <select data-role="episode-select"></select>
          </label>
          <button data-role="episode-apply" class="primary">Übernehmen</button>
        </div>
        <p data-role="episode-info"></p>
      </div>
    `;
    const seasonSelect = slot.querySelector('[data-role="season-select"]');
    const episodeSelect = slot.querySelector('[data-role="episode-select"]');
    const info = slot.querySelector('[data-role="episode-info"]');
    let currentEpisodes = [];
    const loadSeason = async () => {
      const seasonNumber = Number(seasonSelect.value);
      episodeSelect.innerHTML = `<option>Lade Folgen...</option>`;
      info.textContent = "";
      const seasonData = await api.getSeasonMetadata(result.id, seasonNumber);
      currentEpisodes = seasonData.episodes || [];
      episodeSelect.innerHTML = currentEpisodes.map((episode) => `<option value="${escapeHtml(episode.episode)}">${episodeCode(seasonNumber, episode.episode)} - ${escapeHtml(episode.title || `Folge ${episode.episode}`)}</option>`).join("");
      if (!currentEpisodes.length) episodeSelect.innerHTML = `<option value="">Keine Folgen gefunden</option>`;
    };
    seasonSelect.addEventListener("change", () => {
      loadSeason().catch((error) => {
        currentEpisodes = [];
        episodeSelect.innerHTML = `<option value="">Fehler</option>`;
        info.textContent = cleanErrorMessage(error);
      });
    });
    slot.querySelector('[data-role="episode-apply"]').addEventListener("click", async () => {
      const seasonNumber = Number(seasonSelect.value);
      const episodeNumber = Number(episodeSelect.value);
      const episode = currentEpisodes.find((item) => Number(item.episode) === episodeNumber);
      if (!seasonNumber || !episodeNumber || !episode) {
        info.textContent = "Bitte eine gültige Folge wählen.";
        return;
      }
      await onSelect({
        ...result,
        season: seasonNumber,
        episode: episodeNumber,
        episode_title: episode.title || `Episode ${episodeNumber}`,
        tmdb_episode_title: episode.title || `Episode ${episodeNumber}`
      });
    });
    await loadSeason();
  } catch (error) {
    slot.innerHTML = `<p class="status-error">${escapeHtml(cleanErrorMessage(error))}</p>`;
  }
}

async function showMetadataResults(kind, index, results) {
  let visible = results.slice();
  const jobs = jobListForKind(kind);
  const job = jobs[index];
  const renderBody = () => visible.map((result, resultIndex) => `
    <div class="metadata-result">
      ${result.poster_url ? `<img src="${escapeHtml(result.poster_url)}" alt="">` : `<div class="metadata-poster-empty">TMDb</div>`}
      <div>
        <strong>${escapeHtml(result.title)}${result.year ? ` (${escapeHtml(result.year)})` : ""}</strong>
        <span>${escapeHtml(result.media_type)} | Bewertung ${Number(result.vote_average || 0).toFixed(1)} | Popularität ${Math.round(result.popularity || 0)}</span>
        <p>${escapeHtml(result.overview || "Keine Beschreibung vorhanden.")}</p>
      </div>
      <div class="metadata-actions">
        <button data-action="accept" data-index="${resultIndex}" class="primary">Ja, übernehmen</button>
        <button data-action="episodes" data-index="${resultIndex}" class="${result.media_type === "Serie" ? "" : "hidden"}">Staffel/Folge wählen</button>
        <button data-action="wrong" data-index="${resultIndex}">Falsch</button>
        <button data-action="details" data-index="${resultIndex}">Mehr Infos</button>
      </div>
    </div>
  `).join("") || `<p>Keine weiteren Treffer. Nutze Ablehnen oder starte eine neue Suche.</p>`;

  return new Promise((resolve) => {
    els.modalHost.innerHTML = "";
    els.modalHost.classList.remove("hidden");
    const modal = document.createElement("div");
    modal.className = "modal metadata-modal";
    modal.innerHTML = `
      <div class="modal-header"><h2>TMDb Treffer prüfen</h2></div>
      <div class="modal-body">
        <div class="metadata-query">
          <span>Quelle</span>
          <strong>${escapeHtml(basename(job.source))}</strong>
        </div>
        <div class="metadata-detail-slot"></div>
        <div class="metadata-results">${renderBody()}</div>
      </div>
      <div class="modal-footer">
        <button data-action="reject">Ablehnen</button>
      </div>
    `;
    const refreshResults = () => {
      modal.querySelector(".metadata-results").innerHTML = renderBody();
      wireModalButtons();
    };
    const close = () => {
      els.modalHost.classList.add("hidden");
      els.modalHost.innerHTML = "";
      resolve();
    };
    const wireModalButtons = () => {
      modal.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const action = button.dataset.action;
          if (action === "reject") {
            close();
            return;
          }
          const result = visible[Number(button.dataset.index)];
          if (!result) return;
          if (action === "wrong") {
            visible = visible.filter((item) => item.id !== result.id || item.media_type !== result.media_type);
            refreshResults();
            return;
          }
          if (action === "details") {
            modal.querySelector(".metadata-detail-slot").innerHTML = await metadataDetailsHtml(result, job);
            return;
          }
          if (action === "episodes") {
            await showEpisodeChooser(modal, result, async (selectedResult) => {
              await acceptMetadataResult(kind, index, selectedResult);
              close();
            });
            return;
          }
          if (action === "accept") {
            await acceptMetadataResult(kind, index, result);
            close();
          }
        });
      });
    };
    els.modalHost.appendChild(modal);
    wireModalButtons();
  });
}

async function openRetryMetadataSearch(kind, index, initialQuery, initialMessage) {
  return new Promise((resolve) => {
    const jobs = jobListForKind(kind);
    const job = jobs[index];
    els.modalHost.innerHTML = "";
    els.modalHost.classList.remove("hidden");
    const modal = document.createElement("div");
    modal.className = "modal metadata-modal";
    modal.innerHTML = `
      <div class="modal-header"><h2>TMDb Suche verfeinern</h2></div>
      <div class="modal-body">
        <div class="metadata-query">
          <span>Für diesen Job wurde nichts gefunden. Gib Zusatzinfos ein, z.B. nur den Seriennamen.</span>
          <strong>${escapeHtml(basename(job.source))}</strong>
          ${initialMessage ? `<p class="status-error">${escapeHtml(initialMessage)}</p>` : ""}
        </div>
        <div class="metadata-search-bar">
          <input id="retryMetadataQuery" type="search" value="${escapeHtml(initialQuery)}" placeholder="z.B. Miraculous">
          <button id="retryMetadataSearchButton" class="primary">Suchen</button>
        </div>
        <div class="metadata-detail-slot"></div>
        <div id="retryMetadataResults" class="metadata-results"></div>
      </div>
      <div class="modal-footer">
        <button id="retryMetadataCloseButton">Ablehnen</button>
      </div>
    `;

    const resultsHost = modal.querySelector("#retryMetadataResults");
    let visible = [];

    const renderBody = () => visible.map((result, resultIndex) => `
      <div class="metadata-result">
        ${result.poster_url ? `<img src="${escapeHtml(result.poster_url)}" alt="">` : `<div class="metadata-poster-empty">TMDb</div>`}
        <div>
          <strong>${escapeHtml(result.title)}${result.year ? ` (${escapeHtml(result.year)})` : ""}</strong>
          <span>${escapeHtml(result.media_type)} | Bewertung ${Number(result.vote_average || 0).toFixed(1)} | Popularität ${Math.round(result.popularity || 0)}</span>
          <p>${escapeHtml(result.overview || "Keine Beschreibung vorhanden.")}</p>
        </div>
        <div class="metadata-actions">
          <button data-action="accept" data-index="${resultIndex}" class="primary">Ja, übernehmen</button>
          <button data-action="episodes" data-index="${resultIndex}" class="${result.media_type === "Serie" ? "" : "hidden"}">Staffel/Folge wählen</button>
          <button data-action="wrong" data-index="${resultIndex}">Falsch</button>
          <button data-action="details" data-index="${resultIndex}">Mehr Infos</button>
        </div>
      </div>
    `).join("") || `<p>Keine Treffer. Gib mehr oder andere Infos ein.</p>`;

    const close = () => {
      els.modalHost.classList.add("hidden");
      els.modalHost.innerHTML = "";
      resolve();
    };

    const wireResults = () => {
      resultsHost.innerHTML = renderBody();
      resultsHost.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const result = visible[Number(button.dataset.index)];
          if (!result) return;
          if (button.dataset.action === "wrong") {
            visible = visible.filter((item) => item.id !== result.id || item.media_type !== result.media_type);
            wireResults();
            return;
          }
          if (button.dataset.action === "details") {
            modal.querySelector(".metadata-detail-slot").innerHTML = await metadataDetailsHtml(result, job);
            return;
          }
          if (button.dataset.action === "episodes") {
            await showEpisodeChooser(modal, result, async (selectedResult) => {
              await acceptMetadataResult(kind, index, selectedResult);
              close();
            });
            return;
          }
          await acceptMetadataResult(kind, index, result);
          close();
        });
      });
    };

    const runSearch = async () => {
      const query = modal.querySelector("#retryMetadataQuery").value.trim();
      if (!query) return;
      resultsHost.innerHTML = "<p>Suche läuft...</p>";
      try {
        const response = await api.searchMetadata(query, "auto", metadataContext(job));
        visible = response.results || [];
        wireResults();
      } catch (error) {
        visible = [];
        resultsHost.innerHTML = `<p class="status-error">${escapeHtml(cleanErrorMessage(error))}</p>`;
      }
    };

    els.modalHost.appendChild(modal);
    modal.querySelector("#retryMetadataCloseButton").addEventListener("click", close);
    modal.querySelector("#retryMetadataSearchButton").addEventListener("click", runSearch);
    modal.querySelector("#retryMetadataQuery").addEventListener("keydown", (event) => {
      if (event.key === "Enter") runSearch();
    });
    modal.querySelector("#retryMetadataQuery").focus();
  });
}

async function searchMetadataForJob(kind, index) {
  const jobs = jobListForKind(kind);
  const job = jobs[index];
  if (!job) return;
  const query = metadataSearchQuery(job);
  try {
    setGlobalStatus("Bereit", "TMDb Suche läuft...");
    const result = await api.searchMetadata(query, job.media_type, metadataContext(job));
    await showMetadataResults(kind, index, result.results || []);
    setGlobalStatus("Bereit", "TMDb Suche abgeschlossen.");
  } catch (error) {
    const message = cleanErrorMessage(error);
    appendLog(`TMDb Suche fehlgeschlagen: ${message}`, true);
    if (/Keine TMDb Treffer gefunden/i.test(message)) {
      await openRetryMetadataSearch(kind, index, query, message);
      setGlobalStatus("Bereit", "TMDb Suche bereit.");
    } else {
      await showMessage("TMDb Suche", message, true);
      setGlobalStatus("Fehler", "TMDb Suche fehlgeschlagen.");
    }
  }
}

async function pickRenamePaths(kind, sourceKind = "files") {
  const paths = sourceKind === "folders" ? await api.selectRenameFolders() : await api.selectRenameFiles();
  if (!paths.length) return;
  if (kind === "combo") state.comboPaths = paths;
  else state.renamePaths = paths;
  await refreshRenamePreview(kind);
}

function formatMetadataCopyName(result) {
  const title = result.title || result.name || "Unbekannt";
  if (result.media_type === "Film") return result.year ? `${title} (${result.year})` : title;
  return title;
}

function episodeCode(season, episode) {
  return `S${String(Number(season) || 1).padStart(2, "0")}E${String(Number(episode) || 1).padStart(2, "0")}`;
}

async function copyMetadataName(result, season = null, episode = null) {
  let text = formatMetadataCopyName(result);
  if (result.media_type === "Serie" && season && episode) {
    let episodeTitle = result.episode_title || result.tmdb_episode_title || "";
    if (!episodeTitle) {
      try {
        const details = await api.getEpisodeMetadata(result.id, season, episode);
        episodeTitle = details?.title || "";
      } catch {
        episodeTitle = "";
      }
    }
    text = `${result.title} - ${episodeCode(season, episode)}${episodeTitle ? ` - ${episodeTitle}` : ""}`;
  }
  await api.copyPath(text);
  showToast("Name kopiert", text);
}

function renderFreeSearchResults(container, results) {
  container.innerHTML = (results || []).map((result, index) => `
    <div class="metadata-result free-search-result">
      ${result.poster_url ? `<img src="${escapeHtml(result.poster_url)}" alt="">` : `<div class="metadata-poster-empty">TMDb</div>`}
      <div>
        <strong>${escapeHtml(result.title)}${result.year ? ` (${escapeHtml(result.year)})` : ""}</strong>
        <span>${escapeHtml(result.media_type)} | Bewertung ${Number(result.vote_average || 0).toFixed(1)} | Popularität ${Math.round(result.popularity || 0)}</span>
        <p>${escapeHtml(result.overview || "Keine Beschreibung vorhanden.")}</p>
        <div class="episode-copy ${result.media_type === "Serie" ? "" : "hidden"}">
          <label>Staffel<input data-role="season" data-index="${index}" type="number" min="1" value="1"></label>
          <label>Folge<input data-role="episode" data-index="${index}" type="number" min="1" value="1"></label>
        </div>
      </div>
      <div class="metadata-actions">
        <button data-action="copy" data-index="${index}" class="primary" title="Name kopieren" aria-label="Name kopieren">⧉</button>
        <button data-action="episodes" data-index="${index}" class="${result.media_type === "Serie" ? "" : "hidden"}">Staffel/Folge wählen</button>
        <button data-action="details" data-index="${index}">Mehr Infos</button>
      </div>
    </div>
  `).join("") || `<p>Keine Treffer.</p>`;

  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = results[Number(button.dataset.index)];
      if (!result) return;
      if (button.dataset.action === "details") {
        const slot = container.closest(".modal").querySelector(".metadata-detail-slot");
        slot.innerHTML = await metadataDetailsHtml(result, { season: 1, episode: 1 });
        return;
      }
      if (button.dataset.action === "episodes") {
        await showEpisodeChooser(container.closest(".modal"), result, async (selectedResult) => {
          await copyMetadataName(selectedResult, selectedResult.season, selectedResult.episode);
        });
        return;
      }
      const row = button.closest(".metadata-result");
      const season = row.querySelector('[data-role="season"]')?.value || null;
      const episode = row.querySelector('[data-role="episode"]')?.value || null;
      await copyMetadataName(result, season, episode);
    });
  });
}

async function openFreeMetadataSearch() {
  return new Promise((resolve) => {
    els.modalHost.innerHTML = "";
    els.modalHost.classList.remove("hidden");
    const modal = document.createElement("div");
    modal.className = "modal metadata-modal";
    modal.innerHTML = `
      <div class="modal-header"><h2>TMDb Suche</h2></div>
      <div class="modal-body">
        <div class="metadata-search-bar">
          <input id="freeMetadataQuery" type="search" placeholder="Film oder Serie suchen">
          <button id="freeMetadataSearchButton" class="primary">Suchen</button>
        </div>
        <div class="metadata-detail-slot"></div>
        <div id="freeMetadataResults" class="metadata-results"></div>
      </div>
      <div class="modal-footer">
        <button id="freeMetadataCloseButton">Schließen</button>
      </div>
    `;
    const close = () => {
      els.modalHost.classList.add("hidden");
      els.modalHost.innerHTML = "";
      resolve();
    };
    const runSearch = async () => {
      const input = modal.querySelector("#freeMetadataQuery");
      const resultsHost = modal.querySelector("#freeMetadataResults");
      const query = input.value.trim();
      if (!query) {
        input.focus();
        return;
      }
      resultsHost.innerHTML = "<p>Suche läuft...</p>";
      try {
        const result = await api.searchMetadata(query, "auto", {});
        renderFreeSearchResults(resultsHost, result.results || []);
      } catch (error) {
        resultsHost.innerHTML = `<p class="status-error">${escapeHtml(cleanErrorMessage(error))}</p>`;
      }
    };
    els.modalHost.appendChild(modal);
    modal.querySelector("#freeMetadataCloseButton").addEventListener("click", close);
    modal.querySelector("#freeMetadataSearchButton").addEventListener("click", runSearch);
    modal.querySelector("#freeMetadataQuery").addEventListener("keydown", (event) => {
      if (event.key === "Enter") runSearch();
    });
    modal.querySelector("#freeMetadataQuery").focus();
  });
}

async function clearRenameWorkflow(kind) {
  if (kind === "combo") {
    state.comboPaths = [];
    state.comboJobs = [];
  } else {
    state.renamePaths = [];
    state.renameJobs = [];
  }
  renderRenamePreview(kind);
  setGlobalStatus("Bereit", "Vorschau geleert.");
}

async function startRenameOnly() {
  if (!state.renameJobs.length) {
    await showMessage("Umbenennen", "Es gibt keine Umbenennen-Vorschau.");
    return;
  }
  const confirmed = await showModal({
    title: "Umbenennen starten",
    body: "<p>Die Dateien werden jetzt am aktuellen Ort umbenannt oder in die gewählte Plex-Struktur verschoben.</p>",
    small: true,
    buttons: [
      { label: "Abbrechen", value: false },
      { label: "Umbenennen", value: true, primary: true }
    ]
  });
  if (!confirmed) return;
  setGlobalStatus("Kopiert...", "Umbenennen läuft.");
  const result = await api.startRename(state.renameJobs, { refreshAfter: els.renameRefreshInput.checked });
  state.renameJobs = result.jobs || [];
  renderRenamePreview("rename");
  setGlobalStatus(result.failed ? "Fehler" : "Fertig", `${result.success || 0} umbenannt, ${result.failed || 0} fehlgeschlagen.`);
  showToast("Umbenennen abgeschlossen", `${result.success || 0} erfolgreich, ${result.failed || 0} fehlgeschlagen`, Boolean(result.failed));
}

async function startComboFlow() {
  if (!state.comboJobs.length) {
    await showMessage("Beides", "Es gibt keine Umbenennen-Vorschau.");
    return;
  }
  const confirmed = await showModal({
    title: "Beides starten",
    body: "<p>Zuerst wird lokal umbenannt. Danach werden die erfolgreichen Dateien auf das Plex-Ziel übertragen.</p>",
    small: true,
    buttons: [
      { label: "Abbrechen", value: false },
      { label: "Starten", value: true, primary: true }
    ]
  });
  if (!confirmed) return;

  setGlobalStatus("Kopiert...", "Umbenennen für Kombi läuft.");
  const renameResult = await api.startRename(state.comboJobs, { refreshAfter: false });
  state.comboJobs = renameResult.jobs || [];
  renderRenamePreview("combo");
  const finalPaths = state.comboJobs
    .filter((job) => ["Umbenannt", "Unveraendert"].includes(job.status))
    .map((job) => job.final_path || job.target);
  if (!finalPaths.length) {
    setGlobalStatus("Fehler", "Keine erfolgreich umbenannten Dateien für den Transfer.");
    return;
  }

  const result = await api.createJobs(finalPaths, null);
  state.jobs = [];
  state.selectedJobId = null;
  for (const job of result.jobs || []) {
    job.id = state.nextJobId++;
    job.started_at = 0;
    job.last_progress_fraction = 0;
    job.last_progress_at = 0;
    state.jobs.push(job);
  }
  for (const error of result.errors || []) appendLog(error, true);
  if (!state.jobs.length) {
    setGlobalStatus("Fehler", "Nach dem Umbenennen konnten keine Transferjobs erstellt werden.");
    return;
  }
  showWorkflowView("transfer");
  await savePendingJobs();
  renderJobs();
  await startCopyFlow(false, "combo", els.comboRefreshInput.checked);
}

function wireEvents() {
  document.querySelectorAll("[data-workflow]").forEach((button) => {
    button.addEventListener("click", () => setWorkflowMode(button.dataset.workflow));
  });
  els.workflowBackButton.addEventListener("click", () => setWorkflowMode("picker"));
  els.movieButton.addEventListener("click", async () => addPaths(await api.selectMovies(), "Film"));
  els.seriesButton.addEventListener("click", async () => addPaths(await api.selectSeries(), "Serie"));
  els.multiButton.addEventListener("click", async () => addPaths(await api.selectAny(), null));
  els.startButton.addEventListener("click", () => startCopyFlow(false, "transfer"));
  els.cancelButton.addEventListener("click", cancelCopyFlow);
  els.renamePickButton.addEventListener("click", () => pickRenamePaths("rename", "files"));
  els.renameFolderButton.addEventListener("click", () => pickRenamePaths("rename", "folders"));
  els.renameSearchButton.addEventListener("click", openFreeMetadataSearch);
  els.renamePreviewButton.addEventListener("click", () => refreshRenamePreview("rename"));
  els.renameStartButton.addEventListener("click", startRenameOnly);
  els.renameClearButton.addEventListener("click", () => clearRenameWorkflow("rename"));
  els.comboPickButton.addEventListener("click", () => pickRenamePaths("combo", "files"));
  els.comboFolderButton.addEventListener("click", () => pickRenamePaths("combo", "folders"));
  els.comboSearchButton.addEventListener("click", openFreeMetadataSearch);
  els.comboPreviewButton.addEventListener("click", () => refreshRenamePreview("combo"));
  els.comboStartButton.addEventListener("click", startComboFlow);
  els.comboClearButton.addEventListener("click", () => clearRenameWorkflow("combo"));
  els.plexButton.addEventListener("click", async () => {
    setMascotState("refreshing");
    const result = await api.refreshPlex(["Film", "Serie"]);
    if (result.movies_ok || result.series_ok) {
      appendLog("Plex-Refresh erfolgreich ausgelöst.");
      setGlobalStatus("Bereit", "Plex-Refresh gesendet.");
      launchMascotTour("idle");
      showToast("Plex Refresh", "Refresh wurde ausgelöst.");
      await showMessage("Plex Refresh", "Plex-Refresh wurde ausgelöst.");
    } else {
      appendLog("Plex-Refresh konnte nicht ausgelöst werden.", true);
      setGlobalStatus("Fehler", "Plex-Refresh fehlgeschlagen.");
      setMascotState("warning");
      await showMessage("Plex Refresh", "Plex-Refresh konnte nicht ausgelöst werden.", true);
    }
  });
  els.logsButton.addEventListener("click", () => api.openLogs());
  els.speedButton.addEventListener("click", () => runSpeedTestFlow(false));
  els.errorsOnlyToggle.addEventListener("change", refreshLog);
  els.jobSearchInput.addEventListener("input", renderJobs);
  els.settingsButton.addEventListener("click", showSettings);
  els.cancelSettingsButton.addEventListener("click", hideSettings);
  els.tmdbTestButton.addEventListener("click", async () => {
    try {
      state.config = await api.saveConfig(readSettingsDraft());
      setText(els.tmdbStatusText, "TMDb Verbindung wird getestet...");
      await api.testMetadataConfig();
      setText(els.tmdbStatusText, "TMDb Verbindung erfolgreich.");
      showToast("TMDb", "Verbindung erfolgreich.");
    } catch (error) {
      const message = cleanErrorMessage(error);
      setText(els.tmdbStatusText, message);
      await showMessage("TMDb Verbindung", message, true);
    }
  });
  els.saveSettingsButton.addEventListener("click", async () => {
    state.config = await api.saveConfig(readSettingsDraft());
    applyTheme();
    loadSettingsDraft();
    await savePendingJobs();
    appendLog("Einstellungen gespeichert.");
    setText(els.lastAction, "Einstellungen gespeichert.");
    cueMascotState("happy", 1200);
    showToast("Einstellungen gespeichert");
    hideSettings();
    renderJobs();
  });

  els.moveUpButton.addEventListener("click", () => {
    const index = selectedIndex();
    if (index > 0) swapJobs(index, index - 1);
  });
  els.moveDownButton.addEventListener("click", () => {
    const index = selectedIndex();
    if (index >= 0 && index < state.jobs.length - 1) swapJobs(index, index + 1);
  });
  els.removeButton.addEventListener("click", removeSelectedJob);
  els.retryButton.addEventListener("click", retryFailedJobs);
  els.clearButton.addEventListener("click", async () => {
    if (!(await showModal({
      title: "Alle Jobs entfernen",
      body: "<p>Sollen alle Jobs aus der Liste entfernt werden?</p>",
      small: true,
      buttons: [
        { label: "Abbrechen", value: false },
        { label: "Alle entfernen", value: true, danger: true }
      ]
    }))) return;
    state.jobs = [];
    state.selectedJobId = null;
    cueMascotState("sorting", 1100);
    await savePendingJobs();
    appendLog("Alle Jobs entfernt.");
    renderJobs();
  });

  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("active");
  });
  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("active"));
  els.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("active");
    const paths = [...event.dataTransfer.files].map((file) => file.path).filter(Boolean);
    await addPaths(paths, null);
  });

  document.addEventListener("click", (event) => {
    if (!els.contextMenu.contains(event.target)) hideContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
    if (event.key === "Delete") removeSelectedJob();
  });

  api.onCopyStarted(() => appendLog("Kopiervorgang gestartet."));
  api.onCopyLog((payload) => appendLog(payload.message, payload.isError));
  api.onCopyJobStart((payload) => {
    state.activeJobIds.add(payload.id);
    setMascotState("busy");
    renderJobs();
  });
  api.onCopyJobUpdate((payload) => {
    const job = state.jobs.find((item) => item.id === payload.id);
    if (!job) return;
    job.status = payload.status;
    job.progress = payload.progress;
    if (payload.return_code !== undefined) job.return_code = payload.return_code;
    updateJobLiveSpeedFromProgress(job, payload.progress);
    renderJobs();
  });
  api.onCopyJobSpeed((payload) => {
    const job = state.jobs.find((item) => item.id === payload.id);
    if (job) {
      job.live_speed_bytes_per_sec = Number(payload.speed || 0);
      refreshStatus();
    }
  });
  api.onCopyJobDone((payload) => {
    state.activeJobIds.delete(payload.id);
    refreshStatus();
  });
  api.onCopyAllDone(() => {
    state.running = false;
    state.activeJobIds.clear();
    setGlobalStatus("Fertig", "Alle Jobs wurden abgearbeitet.");
    savePendingJobs();
    renderJobs();
  });
  api.onCopyFinished(async (payload) => {
    state.config = await api.getConfig();
    const failed = Number(payload.failed || 0);
    setGlobalStatus(failed ? "Fehler" : "Fertig", failed ? "Mindestens ein Job ist fehlgeschlagen." : "Alle Jobs wurden abgearbeitet.");
    setText(els.lastAction, "Kopiervorgang abgeschlossen.");
    setMascotState(failed ? "warning" : "sleeping");
    showToast(failed ? "Kopiervorgang beendet mit Fehlern" : "Kopiervorgang abgeschlossen", `${payload.success || 0} erfolgreich, ${payload.skipped || 0} übersprungen, ${payload.failed || 0} fehlgeschlagen`, Boolean(failed));
    await showModal({
      title: "Kopiervorgang abgeschlossen",
      body: `<p>${failed ? "Der Kopiervorgang ist beendet, aber mindestens ein Job ist fehlgeschlagen." : "Alle Jobs wurden erfolgreich abgearbeitet."}</p>
        <div class="metric-list" style="margin-top:14px">
          <div><span>Erfolgreich</span><strong>${payload.success || 0}</strong></div>
          <div><span>Übersprungen</span><strong>${payload.skipped || 0}</strong></div>
          <div><span>Fehlgeschlagen</span><strong>${payload.failed || 0}</strong></div>
        </div>`,
      small: true,
      buttons: [{ label: "OK", value: true, primary: true }]
    });
    renderJobs();
  });
  api.onCopyError(async (payload) => {
    state.running = false;
    const message = cleanErrorMessage(payload.message);
    setGlobalStatus("Fehler", message);
    setMascotState("warning");
    appendLog(message, true);
    showToast("Fehler", message, true);
    await showMessage("Fehler", message, true);
    renderJobs();
  });
}

async function init() {
  state.config = await api.getConfig();
  applyTheme();
  loadSettingsDraft();
  restorePendingJobs();
  wireEvents();
  await api.setWorkflowMode("picker");
  showWorkflowView("picker");
  renderRenamePreview("rename");
  renderRenamePreview("combo");
  setGlobalStatus("Bereit", "Wartet auf neue Jobs.");
  renderJobs();
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#fb7185">${escapeHtml(error.stack || error.message)}</pre>`;
});
