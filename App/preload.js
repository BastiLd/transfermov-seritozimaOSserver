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
  startCopy: (jobs) => ipcRenderer.invoke("copy:start", jobs),
  cancelCopy: () => ipcRenderer.invoke("copy:cancel"),
  selectMovies: () => ipcRenderer.invoke("dialog:movie"),
  selectSeries: () => ipcRenderer.invoke("dialog:series"),
  selectAny: () => ipcRenderer.invoke("dialog:any"),
  openLogs: () => ipcRenderer.invoke("logs:open"),
  openPath: (path) => ipcRenderer.invoke("path:open", path),
  copyPath: (path) => ipcRenderer.invoke("path:copy", path),
  refreshPlex: (libraries) => ipcRenderer.invoke("plex:refresh", libraries),
  runSpeedTest: () => ipcRenderer.invoke("speed:test"),
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
