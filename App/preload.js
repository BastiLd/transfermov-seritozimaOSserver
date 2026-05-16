const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("plexTransfer", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  createJobs: (paths, forcedType) => ipcRenderer.invoke("jobs:create", paths, forcedType),
  savePendingJobs: (jobs) => ipcRenderer.invoke("jobs:savePending", jobs),
  getTargetStorage: (jobs) => ipcRenderer.invoke("storage:targets", jobs),
  startCopy: (jobs, options) => ipcRenderer.invoke("copy:start", jobs, options),
  cancelCopy: () => ipcRenderer.invoke("copy:cancel"),
  selectMovies: () => ipcRenderer.invoke("dialog:movie"),
  selectSeries: () => ipcRenderer.invoke("dialog:series"),
  selectAny: () => ipcRenderer.invoke("dialog:any"),
  selectRenameFiles: () => ipcRenderer.invoke("dialog:renameFiles"),
  selectRenameFolders: () => ipcRenderer.invoke("dialog:renameFolders"),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  copyLogs: (text) => ipcRenderer.invoke("logs:copy", text),
  saveLogs: (text) => ipcRenderer.invoke("logs:save", text),
  openPath: (path) => ipcRenderer.invoke("path:open", path),
  copyPath: (path) => ipcRenderer.invoke("path:copy", path),
  refreshPlex: (libraries) => ipcRenderer.invoke("plex:refresh", libraries),
  runSpeedTest: () => ipcRenderer.invoke("speed:test"),
  previewRename: (paths, options) => ipcRenderer.invoke("rename:preview", paths, options),
  startRename: (jobs, options) => ipcRenderer.invoke("rename:start", jobs, options),
  applyMetadataToRenameJob: (job, metadata) => ipcRenderer.invoke("rename:applyMetadata", job, metadata),
  searchMetadata: (query, mediaType, context) => ipcRenderer.invoke("metadata:search", query, mediaType, context),
  getMetadataDetails: (tmdbId, mediaType) => ipcRenderer.invoke("metadata:details", tmdbId, mediaType),
  getEpisodeMetadata: (tvId, season, episode) => ipcRenderer.invoke("metadata:episode", tvId, season, episode),
  getSeasonMetadata: (tvId, season) => ipcRenderer.invoke("metadata:season", tvId, season),
  testMetadataConfig: () => ipcRenderer.invoke("metadata:testConfig"),
  setWorkflowMode: (mode) => ipcRenderer.invoke("workflow:setMode", mode),
  onCopyStarted: (callback) => on("copy:started", callback),
  onCopyLog: (callback) => on("copy:log", callback),
  onCopyJobStart: (callback) => on("copy:job-start", callback),
  onCopyJobUpdate: (callback) => on("copy:job-update", callback),
  onCopyJobSpeed: (callback) => on("copy:job-speed", callback),
  onCopyJobDone: (callback) => on("copy:job-done", callback),
  onCopyAllDone: (callback) => on("copy:all-done", callback),
  onCopyFinished: (callback) => on("copy:finished", callback),
  onCopyError: (callback) => on("copy:error", callback)
});
