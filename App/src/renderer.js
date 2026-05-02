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
  selectMovies: async () => ["D:\\Demo\\Example.Movie.2026.1080p.mkv"],
  selectSeries: async () => ["D:\\Demo\\Example.Show\\Example.Show.S01E01.mkv"],
  selectAny: async () => ["D:\\Demo\\Example.Movie.2026.1080p.mkv", "D:\\Demo\\Example.Show\\Example.Show.S01E01.mkv"],
  openLogs: async () => "",
  openPath: async () => "",
  copyPath: async () => ({ ok: true }),
  refreshPlex: async () => ({ movies_ok: true, series_ok: true }),
  runSpeedTest: async () => ({ bytes_per_sec: 115583665, duration: 9 }),
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
  activeJobIds: new Set(),
  logEntries: [],
  storageWarnings: [],
  storageRequestId: 0
};

const $ = (id) => document.getElementById(id);

const els = {
  app: $("app"),
  mainView: $("mainView"),
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
  rememberInput: $("rememberInput"),
  themeInput: $("themeInput"),
  saveSettingsButton: $("saveSettingsButton"),
  cancelSettingsButton: $("cancelSettingsButton")
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

function loadSettingsDraft() {
  els.moviesRootInput.value = state.config.movies_root || "";
  els.seriesRootInput.value = state.config.series_root || "";
  els.plexUrlInput.value = state.config.plex_url || "";
  els.plexTokenInput.value = state.config.plex_token || "";
  els.moviesSectionInput.value = state.config.movies_section_id || "";
  els.seriesSectionInput.value = state.config.series_section_id || "";
  els.parallelInput.checked = Boolean(state.config.parallel_enabled);
  els.autoRefreshInput.checked = Boolean(state.config.auto_refresh);
  els.rememberInput.checked = Boolean(state.config.remember_pending_jobs);
  els.themeInput.value = state.config.theme_mode || "hell";
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
    remember_pending_jobs: els.rememberInput.checked,
    theme_mode: els.themeInput.value
  };
}

function showSettings() {
  loadSettingsDraft();
  els.mainView.classList.add("hidden");
  els.settingsView.classList.remove("hidden");
  els.settingsButton.disabled = true;
}

function hideSettings() {
  els.settingsView.classList.add("hidden");
  els.mainView.classList.remove("hidden");
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

async function startCopyFlow(skipSpeedPrompt = false) {
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
  renderJobs();
  await api.startCopy(state.jobs);
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
  showToast("Kopiervorgang abgebrochen", "Offene Jobs können erneut gestartet werden.", true);
  await savePendingJobs();
  renderJobs();
}

async function runSpeedTestFlow(autoContinue = false) {
  state.speedTestRunning = true;
  setText(els.lastAction, "Geschwindigkeitstest gestartet.");
  refreshEta();
  try {
    const result = await api.runSpeedTest();
    state.config = await api.getConfig();
    appendLog(`Geschwindigkeitstest abgeschlossen: ${formatSpeed(result.bytes_per_sec)}.`);
    setText(els.lastAction, "Geschwindigkeitstest abgeschlossen.");
    showToast("Geschwindigkeitstest fertig", formatSpeed(result.bytes_per_sec));
    if (autoContinue) await startCopyFlow(true);
  } catch (error) {
    appendLog(`Geschwindigkeitstest fehlgeschlagen: ${error.message}`, true);
    await showMessage("Geschwindigkeitstest fehlgeschlagen", error.message, true);
  } finally {
    state.speedTestRunning = false;
    refreshEta();
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
  showToast("Retry vorbereitet", `${count} Jobs sind wieder bereit.`);
  await savePendingJobs();
  renderJobs();
}

function wireEvents() {
  els.movieButton.addEventListener("click", async () => addPaths(await api.selectMovies(), "Film"));
  els.seriesButton.addEventListener("click", async () => addPaths(await api.selectSeries(), "Serie"));
  els.multiButton.addEventListener("click", async () => addPaths(await api.selectAny(), null));
  els.startButton.addEventListener("click", startCopyFlow);
  els.cancelButton.addEventListener("click", cancelCopyFlow);
  els.plexButton.addEventListener("click", async () => {
    const result = await api.refreshPlex(["Film", "Serie"]);
    if (result.movies_ok || result.series_ok) {
      appendLog("Plex-Refresh erfolgreich ausgelöst.");
      setGlobalStatus("Bereit", "Plex-Refresh gesendet.");
      showToast("Plex Refresh", "Refresh wurde ausgelöst.");
      await showMessage("Plex Refresh", "Plex-Refresh wurde ausgelöst.");
    } else {
      appendLog("Plex-Refresh konnte nicht ausgelöst werden.", true);
      setGlobalStatus("Fehler", "Plex-Refresh fehlgeschlagen.");
      await showMessage("Plex Refresh", "Plex-Refresh konnte nicht ausgelöst werden.", true);
    }
  });
  els.logsButton.addEventListener("click", () => api.openLogs());
  els.speedButton.addEventListener("click", () => runSpeedTestFlow(false));
  els.errorsOnlyToggle.addEventListener("change", refreshLog);
  els.jobSearchInput.addEventListener("input", renderJobs);
  els.settingsButton.addEventListener("click", showSettings);
  els.cancelSettingsButton.addEventListener("click", hideSettings);
  els.saveSettingsButton.addEventListener("click", async () => {
    state.config = await api.saveConfig(readSettingsDraft());
    applyTheme();
    await savePendingJobs();
    appendLog("Einstellungen gespeichert.");
    setText(els.lastAction, "Einstellungen gespeichert.");
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
    setGlobalStatus("Fehler", payload.message);
    appendLog(payload.message, true);
    showToast("Fehler", payload.message, true);
    await showMessage("Fehler", payload.message, true);
    renderJobs();
  });
}

async function init() {
  state.config = await api.getConfig();
  applyTheme();
  loadSettingsDraft();
  restorePendingJobs();
  wireEvents();
  setGlobalStatus("Bereit", "Wartet auf neue Jobs.");
  renderJobs();
}

init().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#fb7185">${escapeHtml(error.stack || error.message)}</pre>`;
});
