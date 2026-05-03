const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard } = require("electron");
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
  refresh_after_transfer: false,
  refresh_after_rename: false,
  refresh_after_combo: false,
  rename_folder_structure_mode: "plex",
  tmdb_access_token: "",
  tmdb_language: "de-DE",
  tmdb_region: "DE",
  metadata_provider: "tmdb",
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

function normalizeConfig(parsed = {}) {
  const migratedRefresh = Boolean(parsed.auto_refresh);
  const config = { ...DEFAULT_CONFIG, ...parsed };
  if (parsed.refresh_after_transfer === undefined) config.refresh_after_transfer = migratedRefresh;
  if (parsed.refresh_after_rename === undefined) config.refresh_after_rename = migratedRefresh;
  if (parsed.refresh_after_combo === undefined) config.refresh_after_combo = migratedRefresh;
  if (!["none", "plex"].includes(config.rename_folder_structure_mode)) config.rename_folder_structure_mode = "plex";
  if (!config.tmdb_language) config.tmdb_language = "de-DE";
  if (!config.tmdb_region) config.tmdb_region = "DE";
  config.metadata_provider = "tmdb";
  if (!["hell", "dunkel"].includes(config.theme_mode)) config.theme_mode = "hell";
  config.auto_refresh = Boolean(config.refresh_after_transfer);
  return config;
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
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function saveConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(normalizeConfig(config), null, 2), "utf8");
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

function titleCaseWords(rawName) {
  return sanitizeName(rawName)
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function normalizeShowName(rawName) {
  return normalizeTitle(rawName, "Serie")
    .replace(/\b(?:season|staffel|saison|series)\s*\d{1,2}\b.*$/i, "")
    .replace(/\b(?:complete|web[- ]?dl|webrip|nf|hulu|x264|x265|720p|1080p|2160p)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[ ._-]+|[ ._-]+$/g, "") || "Unbekannt";
}

function looksLikeVideo(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function detectSeasonNumber(name) {
  const match = /(?:s(\d{1,2})\s*e\d{1,2})|(?:(\d{1,2})x\d{1,2})/i.exec(name);
  if (!match) return null;
  return Number(match[1] || match[2]);
}

function detectEpisodeParts(name) {
  const patterns = [
    /(?:s|season)[\s._-]*(\d{1,2})[\s._-]*(?:e|ep|episode)[\s._-]*(\d{1,3})/i,
    /(\d{1,2})x(\d{1,3})/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(name);
    if (match) {
      return {
        season: Number(match[1]),
        episode: Number(match[2]),
        index: match.index,
        end: match.index + match[0].length
      };
    }
  }
  return null;
}

function extractShowNameFromEpisode(name) {
  const episode = detectEpisodeParts(name);
  if (!episode) return normalizeShowName(name);
  const prefix = name.slice(0, episode.index).replace(/[\s._-]+$/g, "");
  return normalizeShowName(/^[a-z]$/i.test(prefix) ? "" : prefix);
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

function collectVideoFiles(sourcePath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) return looksLikeVideo(sourcePath) ? [sourcePath] : [];

  const files = [];
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
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile() && looksLikeVideo(entryPath)) files.push(entryPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "de"));
}

function cleanEpisodeTitle(stem, episode) {
  let raw = episode ? stem.slice(episode.end) : stem;
  raw = raw
    .replace(/^[\s._-]+/g, "")
    .replace(/[\s._-]+$/g, "")
    .replace(/[\s._-]*(2160p|1080p|720p|480p|bluray|brrip|web[-_. ]?dl|webrip|hdrip|dvdrip|x264|x265|h\.?264|h\.?265|hevc|dts|aac[.\d]*|ac3|proper|repack|remux|multi|german|dubbed)\b.*$/i, "")
    .replace(/[_-][A-Za-z0-9]{6,12}$/i, "");
  return titleCaseWords(raw || "Episode");
}

function detectMovieYear(stem, fallbackYear) {
  const explicit = /\b(19\d{2}|20\d{2})\b/.exec(stem);
  const year = explicit ? explicit[1] : String(fallbackYear || "").trim();
  return /^(19\d{2}|20\d{2})$/.test(year) ? year : "";
}

function movieTitleFromStem(stem) {
  return normalizeTitle(stem.replace(/\b(19\d{2}|20\d{2})\b/g, ""), "Film");
}

function uniquePathForPreview(targetPath, sourcePath) {
  if (path.resolve(targetPath).toLowerCase() === path.resolve(sourcePath).toLowerCase()) return targetPath;
  if (!fs.existsSync(targetPath)) return targetPath;
  const parsed = path.parse(targetPath);
  let index = 2;
  let candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
  }
  return candidate;
}

function mediaBaseFromMetadata(job, metadata) {
  if (job.media_type === "Serie") {
    const showName = normalizeShowName(metadata.title || metadata.name || job.tmdb_title || "Unbekannt");
    const season = Number(metadata.season || metadata.selected_season || job.season || 1);
    const episode = Number(metadata.episode || metadata.selected_episode || job.episode || 1);
    const episodeTitle = titleCaseWords(metadata.episode_title || metadata.tmdb_episode_title || "Episode");
    return {
      name: `${showName} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} - ${episodeTitle}`,
      parentName: showName,
      season
    };
  }
  const title = normalizeTitle(metadata.title || metadata.name || job.tmdb_title || "Unbekannt", "Film");
  const year = detectMovieYear("", metadata.year || metadata.release_year || "");
  const name = year ? `${title} (${year})` : title;
  return { name, parentName: name, year };
}

function applyMetadataToRenameJob(job, metadata = {}) {
  const effectiveJob = metadata.media_type && metadata.media_type !== job.media_type ? { ...job, media_type: metadata.media_type } : job;
  const source = path.resolve(job.source || "");
  const parsedSource = path.parse(source);
  const parsedTarget = path.parse(job.target || source);
  const base = mediaBaseFromMetadata(effectiveJob, metadata);
  let targetDir = parsedTarget.dir || parsedSource.dir;

  if (effectiveJob.media_type === "Serie") {
    const seasonDirName = `Season ${String(base.season || 1).padStart(2, "0")}`;
    const currentDirName = path.basename(targetDir);
    if (/^Season\s+\d{2}$/i.test(currentDirName)) {
      const showRoot = path.dirname(targetDir);
      targetDir = path.join(path.dirname(showRoot), base.parentName, seasonDirName);
    }
  } else if (path.basename(targetDir) === parsedTarget.name || /\(\d{4}\)$/.test(path.basename(targetDir))) {
    targetDir = path.join(path.dirname(targetDir), base.parentName);
  }

  const target = uniquePathForPreview(path.join(targetDir, `${base.name}${parsedSource.ext}`), source);
  return {
    ...effectiveJob,
    target,
    label: base.name,
    warning: "",
    metadata_source: "tmdb",
    tmdb_id: metadata.id || job.tmdb_id || null,
    tmdb_title: metadata.title || metadata.name || job.tmdb_title || "",
    tmdb_year: metadata.year || metadata.release_year || job.tmdb_year || "",
    tmdb_episode_title: metadata.episode_title || metadata.tmdb_episode_title || job.tmdb_episode_title || "",
    metadata_confirmed: true
  };
}

function renamePreviewForFile(filePath, context) {
  const parsed = path.parse(filePath);
  const episode = detectEpisodeParts(parsed.name);
  const forcedType = context.mediaType;
  const mediaType = forcedType === "Film" || forcedType === "Serie" ? forcedType : context.sourceWasDirectory || episode ? "Serie" : "Film";
  const structureMode = context.structureMode === "plex" ? "plex" : "none";
  let target;
  let label;
  let year = "";
  let warning = "";
  let jobSeason = null;
  let jobEpisode = null;

  if (mediaType === "Serie") {
    const season = episode?.season || 1;
    const episodeNumber = episode?.episode || 1;
    const extractedShow = extractShowNameFromEpisode(parsed.name);
    const showName = normalizeShowName(context.showName || (extractedShow === "Unbekannt" ? context.defaultShowName : extractedShow));
    const episodeTitle = cleanEpisodeTitle(parsed.name, episode);
    const newName = `${showName} - S${String(season).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")} - ${episodeTitle}${parsed.ext}`;
    if (!episode) warning = "Keine Episode erkannt; S01E01 wird als Vorschlag genutzt.";
    const baseDir = structureMode === "plex" ? path.join(context.showRoot || parsed.dir, `Season ${String(season).padStart(2, "0")}`) : parsed.dir;
    target = path.join(baseDir, newName);
    label = `${showName} S${String(season).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
    jobSeason = season;
    jobEpisode = episodeNumber;
  } else {
    year = detectMovieYear(parsed.name, context.movieYear);
    const title = movieTitleFromStem(parsed.name);
    const movieBase = year ? `${title} (${year})` : title;
    const newName = `${movieBase}${parsed.ext}`;
    if (!year) warning = "Kein Filmjahr erkannt. Der Vorschlag bleibt ohne Jahr.";
    const baseDir = structureMode === "plex" ? path.join(parsed.dir, movieBase) : parsed.dir;
    target = path.join(baseDir, newName);
    label = movieBase;
  }

  target = uniquePathForPreview(target, filePath);
  const previewJob = {
    source: filePath,
    target,
    media_type: mediaType,
    status: path.resolve(filePath).toLowerCase() === path.resolve(target).toLowerCase() ? "Unveraendert" : "Bereit",
    size_bytes: calculateSourceSize(filePath),
    size_label: formatSize(calculateSourceSize(filePath)),
    label,
    warning,
    year,
    season: jobSeason || null,
    episode: jobEpisode || null,
    metadata_source: "",
    tmdb_id: null,
    tmdb_title: "",
    tmdb_year: "",
    tmdb_episode_title: "",
    metadata_confirmed: false,
    plex_movies_root: context.moviesRoot || "",
    plex_series_root: context.seriesRoot || "",
    plex_url_configured: Boolean(context.plexUrl),
    plex_section_id: mediaType === "Film" ? context.moviesSectionId || "" : context.seriesSectionId || ""
  };
  return previewJob;
}

function createRenamePreview(paths, options = {}) {
  const jobs = [];
  const errors = [];
  const config = loadConfig();
  const structureMode = options.structureMode || options.rename_folder_structure_mode || config.rename_folder_structure_mode;
  const mediaType = options.mediaType || "auto";
  const movieYear = options.movieYear || "";
  const explicitShowName = options.showName || "";

  for (const item of paths || []) {
    try {
      const resolved = path.resolve(item);
      if (!fs.existsSync(resolved)) throw new Error(`Pfad nicht gefunden:\n${resolved}`);
      const stat = fs.statSync(resolved);
      const selectedDir = stat.isDirectory() ? resolved : path.dirname(resolved);
      const defaultShowName = normalizeShowName(explicitShowName || path.basename(selectedDir));
      const showRoot = stat.isDirectory() ? resolved : path.join(path.dirname(resolved), defaultShowName);
      const files = collectVideoFiles(resolved);
      if (!files.length) throw new Error(`Keine Videodateien gefunden:\n${resolved}`);
      for (const filePath of files) {
        jobs.push(renamePreviewForFile(filePath, {
          mediaType,
          structureMode,
          movieYear,
          showName: explicitShowName,
          defaultShowName,
          showRoot,
          sourceWasDirectory: stat.isDirectory(),
          moviesRoot: expandHome(config.movies_root),
          seriesRoot: expandHome(config.series_root),
          plexUrl: config.plex_url,
          moviesSectionId: config.movies_section_id,
          seriesSectionId: config.series_section_id
        }));
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  return { jobs, errors };
}

async function startRename(jobs, options = {}) {
  if (running || speedTestRunning) throw new Error("Es läuft bereits ein Vorgang.");
  if (!jobs || !jobs.length) throw new Error("Es sind keine Umbenennen-Jobs vorhanden.");

  running = true;
  currentLogPath = path.join(logsDir(), `rename_${nowStamp()}.log`);
  ensureDir(logsDir());
  appendLog("Umbenennen gestartet.", false);

  const results = [];
  for (const job of jobs) {
    const source = path.resolve(job.source || "");
    const target = path.resolve(job.target || "");
    try {
      if (!fs.existsSync(source)) throw new Error("Quelle nicht gefunden.");
      if (!target) throw new Error("Ziel fehlt.");
      if (source.toLowerCase() === target.toLowerCase()) {
        results.push({ ...job, final_path: source, status: "Unveraendert" });
        appendLog(`Unveraendert: ${source}`, false);
        continue;
      }
      if (fs.existsSync(target)) throw new Error(`Ziel existiert bereits: ${target}`);
      ensureDir(path.dirname(target));
      fs.renameSync(source, target);
      results.push({ ...job, final_path: target, status: "Umbenannt" });
      appendLog(`Umbenannt: ${source} -> ${target}`, false);
    } catch (error) {
      results.push({ ...job, final_path: source, status: "Fehler", error: error.message });
      appendLog(`Umbenennen fehlgeschlagen: ${source} -> ${target}: ${error.message}`, true);
    }
  }

  running = false;
  const successJobs = results.filter((job) => ["Umbenannt", "Unveraendert"].includes(job.status));
  const failed = results.length - successJobs.length;
  let refresh = { movies_ok: false, series_ok: false };
  if (options.refreshAfter && successJobs.length) {
    const libraries = [...new Set(successJobs.map((job) => job.media_type))];
    refresh = await triggerPlexRefresh(loadConfig(), libraries);
    appendLog(refresh.movies_ok || refresh.series_ok ? "Plex-Refresh nach Umbenennen erfolgreich ausgelöst." : "Plex-Refresh nach Umbenennen konnte nicht ausgelöst werden.", !(refresh.movies_ok || refresh.series_ok));
  }
  appendLog("Umbenennen abgeschlossen.", Boolean(failed));
  currentLogPath = null;
  return { jobs: results, success: successJobs.length, failed, refresh };
}

function tmdbConfig() {
  const config = loadConfig();
  let token = String(config.tmdb_access_token || "").trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "");
  if (!token) throw new Error("TMDb Token fehlt. Bitte in den Einstellungen eintragen.");
  const isBearerToken = token.startsWith("eyJ") || token.split(".").length === 3;
  return {
    token,
    authMode: isBearerToken ? "bearer" : "api_key",
    language: String(config.tmdb_language || "de-DE").trim() || "de-DE",
    region: String(config.tmdb_region || "DE").trim() || "DE"
  };
}

function tmdbRequest(endpoint, params = {}) {
  const { token, authMode, language, region } = tmdbConfig();
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  const requestParams = { language, ...params };
  if (region && !requestParams.region) requestParams.region = region;
  if (authMode === "api_key") requestParams.api_key = token;
  for (const [key, value] of Object.entries(requestParams)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers = { Accept: "application/json" };
  if (authMode === "bearer") headers.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      headers,
      timeout: 12000
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          reject(new Error("TMDb Antwort konnte nicht gelesen werden."));
          return;
        }
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error("TMDb Token/API-Key ist ungültig oder nicht erlaubt."));
          return;
        }
        if (res.statusCode === 429) {
          reject(new Error("TMDb Rate Limit erreicht. Bitte später erneut versuchen."));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(parsed.status_message || `TMDb Fehler ${res.statusCode}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("timeout", () => req.destroy(new Error("TMDb Anfrage Timeout.")));
    req.on("error", (error) => reject(new Error(`TMDb nicht erreichbar: ${error.message}`)));
    req.end();
  });
}

function normalizeTmdbResult(item, mediaType) {
  const isMovie = mediaType === "Film" || item.media_type === "movie";
  const date = isMovie ? item.release_date : item.first_air_date;
  const title = isMovie ? item.title : item.name;
  const originalTitle = isMovie ? item.original_title : item.original_name;
  const year = date ? String(date).slice(0, 4) : "";
  return {
    id: item.id,
    media_type: isMovie ? "Film" : "Serie",
    title: title || originalTitle || "Unbekannt",
    original_title: originalTitle || title || "",
    year,
    date: date || "",
    overview: item.overview || "",
    vote_average: item.vote_average || 0,
    popularity: item.popularity || 0,
    poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : "",
    backdrop_url: item.backdrop_path ? `https://image.tmdb.org/t/p/w300${item.backdrop_path}` : ""
  };
}

async function searchMetadata(query, mediaType, context = {}) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) throw new Error("Suchbegriff fehlt.");
  const type = mediaType === "Serie" ? "Serie" : mediaType === "Film" ? "Film" : "auto";
  const endpoint = type === "Serie" ? "/search/tv" : type === "Film" ? "/search/movie" : "/search/multi";
  const params = { query: normalizedQuery, page: 1, include_adult: false };
  if (type === "Film" && context.year) {
    params.year = context.year;
    params.primary_release_year = context.year;
  }
  if (type === "Serie" && context.year) params.first_air_date_year = context.year;
  const response = await tmdbRequest(endpoint, params);
  const rawResults = (response.results || [])
    .filter((item) => type !== "auto" || ["movie", "tv"].includes(item.media_type))
    .slice(0, 8);
  const results = rawResults.map((item) => normalizeTmdbResult(item, type === "Serie" ? "Serie" : type === "Film" ? "Film" : item.media_type === "tv" ? "Serie" : "Film"));
  if (!results.length) throw new Error("Keine TMDb Treffer gefunden.");
  return { results };
}

async function metadataDetails(tmdbId, mediaType) {
  const type = mediaType === "Serie" ? "Serie" : "Film";
  const endpoint = type === "Serie" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
  const item = await tmdbRequest(endpoint, {});
  const details = normalizeTmdbResult(item, type);
  if (type === "Serie") {
    details.seasons = (item.seasons || [])
      .filter((season) => Number.isFinite(Number(season.season_number)))
      .map((season) => ({
        season_number: Number(season.season_number),
        name: season.name || `Season ${season.season_number}`,
        episode_count: Number(season.episode_count || 0),
        air_date: season.air_date || "",
        overview: season.overview || "",
        poster_url: season.poster_path ? `https://image.tmdb.org/t/p/w185${season.poster_path}` : ""
      }));
  }
  return details;
}

async function metadataEpisode(tvId, season, episode) {
  const item = await tmdbRequest(`/tv/${tvId}/season/${season}/episode/${episode}`, {});
  return {
    id: item.id,
    title: item.name || `Episode ${episode}`,
    overview: item.overview || "",
    date: item.air_date || "",
    season: Number(season),
    episode: Number(episode),
    vote_average: item.vote_average || 0,
    still_url: item.still_path ? `https://image.tmdb.org/t/p/w300${item.still_path}` : ""
  };
}

async function metadataSeason(tvId, season) {
  const item = await tmdbRequest(`/tv/${tvId}/season/${season}`, {});
  return {
    id: item.id,
    season: Number(item.season_number || season),
    title: item.name || `Season ${season}`,
    overview: item.overview || "",
    air_date: item.air_date || "",
    poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : "",
    episodes: (item.episodes || []).map((episode) => ({
      id: episode.id,
      episode: Number(episode.episode_number || 0),
      title: episode.name || `Episode ${episode.episode_number}`,
      overview: episode.overview || "",
      date: episode.air_date || "",
      vote_average: episode.vote_average || 0,
      still_url: episode.still_path ? `https://image.tmdb.org/t/p/w300${episode.still_path}` : ""
    })).filter((episode) => episode.episode > 0)
  };
}

async function testTmdbConfig() {
  await tmdbRequest("/configuration", {});
  return { ok: true };
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
      const extractedShowName = extractShowNameFromEpisode(path.parse(resolvedPath).name);
      const showName = extractedShowName === "Unbekannt" ? normalizeShowName(path.basename(path.dirname(resolvedPath))) : extractedShowName;
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

function refreshEnabledForWorkflow(config, workflow) {
  if (workflow === "combo") return Boolean(config.refresh_after_combo);
  if (workflow === "rename") return Boolean(config.refresh_after_rename);
  return Boolean(config.refresh_after_transfer ?? config.auto_refresh);
}

async function startCopy(jobs, options = {}) {
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

  const shouldRefresh = typeof options.refreshAfter === "boolean" ? options.refreshAfter : refreshEnabledForWorkflow(config, options.workflow || "transfer");
  if (shouldRefresh && success > 0) {
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
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 520,
    height: 430,
    minWidth: 480,
    minHeight: 390,
    title: APP_NAME,
    backgroundColor: "#171b22",
    autoHideMenuBar: true,
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
ipcMain.handle("copy:start", (_event, jobs, options) => {
  startCopy(jobs, options || {}).catch((error) => {
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
ipcMain.handle("dialog:renameFiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Dateien zum Umbenennen auswählen",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Videodateien", extensions: [...VIDEO_EXTENSIONS].map((ext) => ext.slice(1)) },
      { name: "Alle Dateien", extensions: ["*"] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("dialog:renameFolders", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Ordner zum Umbenennen auswählen",
    properties: ["openDirectory", "multiSelections"]
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
ipcMain.handle("rename:preview", (_event, paths, options) => createRenamePreview(paths, options || {}));
ipcMain.handle("rename:start", (_event, jobs, options) => startRename(jobs, options || {}));
ipcMain.handle("rename:applyMetadata", (_event, job, metadata) => applyMetadataToRenameJob(job, metadata || {}));
ipcMain.handle("metadata:search", (_event, query, mediaType, context) => searchMetadata(query, mediaType, context || {}));
ipcMain.handle("metadata:details", (_event, tmdbId, mediaType) => metadataDetails(tmdbId, mediaType));
ipcMain.handle("metadata:episode", (_event, tvId, season, episode) => metadataEpisode(tvId, season, episode));
ipcMain.handle("metadata:season", (_event, tvId, season) => metadataSeason(tvId, season));
ipcMain.handle("metadata:testConfig", () => testTmdbConfig());
ipcMain.handle("workflow:setMode", (_event, mode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  if (["transfer", "rename", "combo"].includes(mode)) {
    mainWindow.setMinimumSize(1120, 720);
    mainWindow.setSize(1380, 900, true);
    mainWindow.center();
  } else {
    mainWindow.setMinimumSize(500, 380);
    mainWindow.setSize(560, 440, true);
    mainWindow.center();
  }
  return { ok: true };
});
