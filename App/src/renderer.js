const api = window.plexTransfer;

const state = {
  config: null,
  jobs: [],
  selectedJobId: null,
  nextJobId: 1,
  running: false,
  speedTestRunning: false,
  activeJobIds: new Set(),
  logEntries: []
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
  plexButton: $("plexButton"),
  logsButton: $("logsButton"),
  speedButton: $("speedButton"),
  dropZone: $("dropZone"),
  jobsBody: $("jobsBody"),
  emptyJobs: $("emptyJobs"),
  jobMeta: $("jobMeta"),
  jobStatusLine: $("jobStatusLine"),
  moveUpButton: $("moveUpButton"),
  moveDownButton: $("moveDownButton"),
  removeButton: $("removeButton"),
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

function progressToFraction(progress) {
  const match = String(progress || "").match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!match) return 0;
  return Math.max(0, Math.min(1, Number(match[1]) / 100));
}

function shortPath(value) {
  const raw = String(value || "");
  if (raw.length <= 72) return raw;
  return `${raw.slice(0, 28)}...${raw.slice(-38)}`;
}

function setGlobalStatus(title, detail) {
  setText(els.statusBadge, title);
  setText(els.statusDetail, detail);
  els.statusBadge.style.background = title === "Fehler" ? "var(--danger)" : title === "Fertig" ? "var(--success)" : title === "Kopiert..." ? "var(--primary)" : "var(--primary-soft)";
  els.statusBadge.style.color = ["Fehler", "Fertig", "Kopiert..."].includes(title) ? "#fff" : "var(--text)";
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
  if (state.jobs.length) {
    appendLog(`${state.jobs.length} offene Jobs wiederhergestellt.`);
  }
}

function openJobs() {
  return state.jobs.filter((job) => !["Kopiert", "Uebersprungen"].includes(job.status) && !String(job.status).startsWith("Fehler"));
}

function selectedIndex() {
  return state.jobs.findIndex((job) => job.id === state.selectedJobId);
}

function statusClass(status) {
  if (status === "Kopiert") return "status-ok";
  if (status === "Kopiert..." || status === "Wartet") return "status-warn";
  if (String(status).startsWith("Fehler")) return "status-error";
  return "";
}

function renderJobs() {
  els.jobsBody.innerHTML = "";
  for (const job of state.jobs) {
    const row = document.createElement("tr");
    row.className = job.id === state.selectedJobId ? "selected" : "";
    row.addEventListener("click", () => {
      state.selectedJobId = job.id;
      renderJobs();
    });
    row.innerHTML = `
      <td>${job.media_type}</td>
      <td class="path-cell" title="${escapeHtml(job.source)}">${escapeHtml(shortPath(job.source))}</td>
      <td class="path-cell" title="${escapeHtml(job.target)}">${escapeHtml(shortPath(job.target))}</td>
      <td>${escapeHtml(job.size_label || formatSize(job.size_bytes))}</td>
      <td class="${statusClass(job.status)}">${escapeHtml(job.status)}</td>
      <td>${escapeHtml(job.progress || "-")}</td>
    `;
    els.jobsBody.appendChild(row);
  }

  els.emptyJobs.classList.toggle("hidden", state.jobs.length > 0);
  const waiting = state.jobs.filter((job) => ["Bereit", "Wartet"].includes(job.status)).length;
  const active = state.jobs.filter((job) => job.status === "Kopiert...").length;
  const failed = state.jobs.filter((job) => String(job.status).startsWith("Fehler")).length;
  setText(els.jobMeta, `${state.jobs.length} Jobs in der Liste`);
  setText(els.jobStatusLine, `${waiting} wartend | ${active} laeuft | ${failed} Fehler`);

  const index = selectedIndex();
  els.moveUpButton.disabled = state.running || index <= 0;
  els.moveDownButton.disabled = state.running || index < 0 || index >= state.jobs.length - 1;
  els.removeButton.disabled = state.running || index < 0;
  els.clearButton.disabled = state.running || state.jobs.length === 0;
  refreshStatus();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function refreshActiveRows() {
  els.activeRows.innerHTML = "";
  const activeJobs = state.jobs.filter((job) => state.activeJobIds.has(job.id)).slice(0, 2);
  for (const job of activeJobs) {
    const row = document.createElement("div");
    row.className = "active-row";
    row.innerHTML = `
      <div class="row-heading"><strong>${escapeHtml(shortPath(job.source.split(/[\\/]/).pop() || job.source))}</strong><span>${escapeHtml(job.progress || "0%")}</span></div>
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
    if (["Kopiert", "Uebersprungen"].includes(job.status) || String(job.status).startsWith("Fehler")) return sum;
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
    setText(els.etaTitle, "Geschaetzte Dauer: Messung laeuft");
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
    setText(els.etaTitle, "Geschaetzte Dauer: nicht verfuegbar");
    setText(els.etaDetail, "Fuege zuerst Jobs hinzu.");
  } else if (remaining <= 0) {
    setText(els.etaTitle, "Geschaetzte Dauer: nichts offen");
    setText(els.etaDetail, "Alle aktuellen Jobs sind abgeschlossen oder uebersprungen.");
  } else {
    const speed = Number(state.config?.last_measured_bytes_per_sec || 0);
    if (speed > 0) {
      setText(els.etaTitle, `Geschaetzte Dauer: ${formatEta(remaining / speed)}`);
      setText(els.etaDetail, measurementNote());
    } else {
      setText(els.etaTitle, "Geschaetzte Dauer: nicht verfuegbar");
      setText(els.etaDetail, "Noch kein Messwert vorhanden. Nutze Geschwindigkeit testen.");
    }
  }
  els.speedButton.disabled = state.running || state.speedTestRunning;
}

function refreshStatus() {
  const total = state.jobs.length || 0;
  const success = state.jobs.filter((job) => job.status === "Kopiert").length;
  const skipped = state.jobs.filter((job) => job.status === "Uebersprungen").length;
  const failed = state.jobs.filter((job) => String(job.status).startsWith("Fehler")).length;
  const completed = success + skipped + failed;
  const fraction = total ? completed / total : 0;
  els.overallProgress.style.width = `${Math.round(fraction * 100)}%`;
  setText(els.overallProgressText, `${Math.round(fraction * 100)}% abgeschlossen`);
  setText(els.summary, total ? `Erfolgreich ${success} | Uebersprungen ${skipped} | Fehlgeschlagen ${failed}` : "Noch keine Kopiervorgaenge gestartet.");

  const open = state.jobs.filter((job) => !["Kopiert", "Uebersprungen"].includes(job.status));
  const totalSize = open.reduce((sum, job) => sum + Number(job.size_bytes || 0), 0);
  setText(els.transferSize, totalSize > 0 ? `Offene Transfers: ${formatSize(totalSize)}` : state.jobs.length ? "Offene Transfers: nichts offen" : "Offene Transfers: -");
  const targets = [...new Set(open.map((job) => job.media_type === "Film" ? state.config.movies_root : state.config.series_root).filter(Boolean))];
  setText(els.targetSpace, targets.length ? targets.map((root) => `${root}: ${formatSize(totalSize)} geplant`).join("\n") : "-");
  refreshActiveRows();
  refreshEta();
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
  for (const job of result.jobs) {
    job.id = state.nextJobId++;
    job.started_at = 0;
    job.last_progress_fraction = 0;
    job.last_progress_at = 0;
    state.jobs.push(job);
    state.selectedJobId = job.id;
    appendLog(`Job hinzugefuegt: ${job.media_type} | ${job.source} -> ${job.target}`);
    setText(els.lastAction, `Job hinzugefuegt: ${job.source.split(/[\\/]/).pop()}`);
  }
  for (const error of result.errors || []) appendLog(error, true);
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
  const items = state.jobs.map((job) => `
    <div class="preview-item">
      <strong>${escapeHtml(job.media_type)} · ${escapeHtml(job.source.split(/[\\/]/).pop() || job.source)}</strong>
      <span>Quelle: ${escapeHtml(job.source)}</span>
      <span>Ziel: ${escapeHtml(job.target)}</span>
    </div>
  `).join("");
  return showModal({
    title: "Zielvorschau vor dem Start",
    body: items || "<p>Keine Jobs vorhanden.</p>",
    buttons: [
      { label: "Abbrechen", value: false },
      { label: "Starten", value: true, primary: true }
    ]
  });
}

async function offerSpeedTest() {
  return showModal({
    title: "Kein Messwert vorhanden",
    body: "<p>Es gibt noch keinen gemessenen Geschwindigkeitswert. Soll ein 1-GB-Testtransfer fuer eine bessere Zeit-Schaetzung ausgefuehrt werden?</p>",
    small: true,
    buttons: [
      { label: "Abbrechen", value: "cancel" },
      { label: "Ohne Messung", value: "skip" },
      { label: "Test starten", value: "test", primary: true }
    ]
  });
}

async function startCopyFlow(skipSpeedPrompt = false) {
  if (state.running || state.speedTestRunning) {
    await showMessage("Plex Transfer", "Es laeuft bereits ein Vorgang.");
    return;
  }
  if (!state.jobs.length) {
    await showMessage("Plex Transfer", "Es sind keine Jobs vorhanden.");
    return;
  }
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
    if (!["Kopiert", "Uebersprungen"].includes(job.status)) {
      job.status = "Wartet";
      job.progress = "0%";
      job.live_speed_bytes_per_sec = 0;
      job.started_at = 0;
      job.last_progress_fraction = 0;
      job.last_progress_at = 0;
    }
  }
  setGlobalStatus("Kopiert...", "Kopiervorgang laeuft.");
  setText(els.lastAction, "Robocopy-Worker gestartet.");
  renderJobs();
  await api.startCopy(state.jobs);
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
    if (autoContinue) await startCopyFlow(true);
  } catch (error) {
    appendLog(`Geschwindigkeitstest fehlgeschlagen: ${error.message}`, true);
    await showMessage("Geschwindigkeitstest fehlgeschlagen", error.message, true);
  } finally {
    state.speedTestRunning = false;
    refreshEta();
  }
}

function wireEvents() {
  els.movieButton.addEventListener("click", async () => addPaths(await api.selectMovies(), "Film"));
  els.seriesButton.addEventListener("click", async () => addPaths(await api.selectSeries(), "Serie"));
  els.multiButton.addEventListener("click", async () => addPaths(await api.selectAny(), null));
  els.startButton.addEventListener("click", startCopyFlow);
  els.plexButton.addEventListener("click", async () => {
    const result = await api.refreshPlex(["Film", "Serie"]);
    if (result.movies_ok || result.series_ok) {
      appendLog("Plex-Refresh erfolgreich ausgeloest.");
      setGlobalStatus("Bereit", "Plex-Refresh gesendet.");
      await showMessage("Plex Refresh", "Plex-Refresh wurde ausgeloest.");
    } else {
      appendLog("Plex-Refresh konnte nicht ausgeloest werden.", true);
      setGlobalStatus("Fehler", "Plex-Refresh fehlgeschlagen.");
      await showMessage("Plex Refresh", "Plex-Refresh konnte nicht ausgeloest werden.", true);
    }
  });
  els.logsButton.addEventListener("click", () => api.openLogs());
  els.speedButton.addEventListener("click", () => runSpeedTestFlow(false));
  els.errorsOnlyToggle.addEventListener("change", refreshLog);
  els.settingsButton.addEventListener("click", showSettings);
  els.cancelSettingsButton.addEventListener("click", hideSettings);
  els.saveSettingsButton.addEventListener("click", async () => {
    state.config = await api.saveConfig(readSettingsDraft());
    applyTheme();
    await savePendingJobs();
    appendLog("Einstellungen gespeichert.");
    setText(els.lastAction, "Einstellungen gespeichert.");
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
  els.removeButton.addEventListener("click", async () => {
    const index = selectedIndex();
    if (index < 0) return;
    const [removed] = state.jobs.splice(index, 1);
    state.selectedJobId = state.jobs[Math.min(index, state.jobs.length - 1)]?.id || null;
    appendLog(`Job entfernt: ${removed.source}`);
    await savePendingJobs();
    renderJobs();
  });
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

  api.onCopyStarted(() => {
    appendLog("Kopiervorgang gestartet.");
  });
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
    await showModal({
      title: "Kopiervorgang abgeschlossen",
      body: `<p>${failed ? "Der Kopiervorgang ist beendet, aber mindestens ein Job ist fehlgeschlagen." : "Alle Jobs wurden erfolgreich abgearbeitet."}</p>
        <div class="metric-list" style="margin-top:14px">
          <div><span>Erfolgreich</span><strong>${payload.success || 0}</strong></div>
          <div><span>Uebersprungen</span><strong>${payload.skipped || 0}</strong></div>
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
  document.body.innerHTML = `<pre style="padding:24px;color:#e06a78">${escapeHtml(error.stack || error.message)}</pre>`;
});
