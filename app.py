# -*- coding: utf-8 -*-
import ctypes
import json
import os
import queue
import re
import subprocess
import threading
import time
import tkinter as tk
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, font as tkfont, messagebox, ttk

import customtkinter as ctk

APP_NAME = "Plex Transfer"
BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
LOG_DIR = BASE_DIR / "logs"
VIDEO_EXTENSIONS = {
    ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".mpg", ".mpeg"
}
SEASON_PATTERN = re.compile(r"^(season|staffel|saison|series)\s*\d+|^s\d{1,2}$", re.IGNORECASE)
INVALID_CHARS = r'<>:"/\\|?*'
EPISODE_PATTERN = re.compile(r"(?i)(?:s(?P<season>\d{1,2})\s*e\d{1,2})|(?:(?P<season_alt>\d{1,2})x\d{1,2})")
TRAILING_RELEASE_PATTERN = re.compile(r"(?i)[\s._-]*(2160p|1080p|720p|480p|bluray|brrip|web[-_. ]?dl|webrip|hdrip|dvdrip|x264|x265|h\.?264|h\.?265|hevc|dts|aac[.\d]*|ac3|yts|etrg|proper|repack|remux|multi|german|dubbed)(?:[\s._-]+.*)?$")
SEPARATOR_PATTERN = re.compile(r"[._]+")
WM_DROPFILES = 0x0233
GWL_WNDPROC = -4
LRESULT = ctypes.c_longlong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_long
DEFAULT_CONFIG = {
    "movies_root": r"Z:\Movies",
    "series_root": r"Z:\Series",
    "plex_url": "",
    "plex_token": "",
    "movies_section_id": "",
    "series_section_id": "",
    "parallel_enabled": False,
    "auto_refresh": False,
    "theme_mode": "hell",
    "last_measured_bytes_per_sec": 0.0,
    "last_measured_at": "",
    "last_measured_source": "",
}

PALETTES = {
    "hell": {
        "appearance": "light",
        "bg": "#edf4fb",
        "surface": "#f7fbff",
        "card": "#ffffff",
        "card_soft": "#f7faff",
        "border": "#d7e4f1",
        "text": "#12243a",
        "muted": "#61758b",
        "subtle": "#8899ac",
        "primary": "#2f6fe4",
        "primary_hover": "#245fca",
        "primary_soft": "#e7f0ff",
        "success": "#2f8f5b",
        "warning": "#c27f1d",
        "danger": "#c54d5b",
        "danger_soft": "#fdecef",
        "success_soft": "#e7f7ee",
        "drop": "#f3f8ff",
        "drop_active": "#e4eeff",
        "log_bg": "#111a24",
        "log_fg": "#dce6ef",
        "table_header": "#f1f6fb",
        "table_selected": "#e7f0ff",
        "scroll": "#c9d8e8",
        "scroll_hover": "#a9bfd8",
        "entry": "#fbfdff",
    },
    "dunkel": {
        "appearance": "dark",
        "bg": "#171b22",
        "surface": "#1d232c",
        "card": "#202833",
        "card_soft": "#252f3b",
        "border": "#303b48",
        "text": "#f1f4f8",
        "muted": "#a6b2c1",
        "subtle": "#7e8b99",
        "primary": "#3478f6",
        "primary_hover": "#2a69de",
        "primary_soft": "#1d2f52",
        "success": "#5dc07a",
        "warning": "#d9a24e",
        "danger": "#e06a78",
        "danger_soft": "#382028",
        "success_soft": "#1c3527",
        "drop": "#232d3a",
        "drop_active": "#2a3950",
        "log_bg": "#11161d",
        "log_fg": "#dce6ef",
        "table_header": "#283240",
        "table_selected": "#2a3d60",
        "scroll": "#435364",
        "scroll_hover": "#556980",
        "entry": "#242d38",
    },
}
STATUS_STYLES = {
    "Bereit": ("primary_soft", "muted"),
    "Kopiert...": ("primary_soft", "primary"),
    "Fertig": ("success_soft", "success"),
    "Fehler": ("danger_soft", "danger"),
}
JOB_COLORS = {
    "Bereit": "muted",
    "Wartet": "warning",
    "Kopiert...": "primary",
    "Kopiert": "success",
    "Übersprungen": "muted",
}

ctk.set_default_color_theme("blue")


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def sanitize_name(raw_name: str) -> str:
    cleaned = "".join("_" if c in INVALID_CHARS else c for c in raw_name)
    cleaned = SEPARATOR_PATTERN.sub(" ", cleaned)
    cleaned = re.sub(r"\s*-\s*", " - ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
    return cleaned or "Unbekannt"


def normalize_title(raw_name: str, media_type: str) -> str:
    cleaned = sanitize_name(raw_name)
    if media_type == "Film":
        cleaned = TRAILING_RELEASE_PATTERN.sub("", cleaned).strip(" ._-")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
    return cleaned or "Unbekannt"


def calculate_source_size(path: Path) -> int:
    try:
        if path.is_file():
            return path.stat().st_size
    except OSError:
        return 0

    total_size = 0
    for root, _dirs, files in os.walk(path):
        for file_name in files:
            file_path = Path(root) / file_name
            try:
                total_size += file_path.stat().st_size
            except OSError:
                continue
    return total_size


def format_size(size_bytes: int) -> str:
    if size_bytes <= 0:
        return "-"
    value = float(size_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(value)} {unit}"
            if value >= 10:
                return f"{value:.0f} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return "-"


def format_speed(bytes_per_sec: float) -> str:
    if bytes_per_sec <= 0:
        return "-"
    return f"{format_size(int(bytes_per_sec))}/s"


def format_eta(seconds_total: float) -> str:
    if seconds_total <= 0:
        return "unter 1 Min"
    minutes = int(round(seconds_total / 60))
    if minutes <= 1:
        return "ca. 1 Min"
    if minutes < 60:
        return f"ca. {minutes} Min"
    hours, rem_minutes = divmod(minutes, 60)
    if rem_minutes == 0:
        return f"ca. {hours} Std"
    return f"ca. {hours} Std {rem_minutes} Min"


def looks_like_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def has_season_subfolders(source_dir: Path) -> bool:
    try:
        return any(
            child.is_dir() and SEASON_PATTERN.match(child.name.strip())
            for child in source_dir.iterdir()
        )
    except OSError:
        return False


def detect_season_number(name: str) -> int | None:
    match = EPISODE_PATTERN.search(name)
    if not match:
        return None
    value = match.group("season") or match.group("season_alt")
    return int(value) if value else None


def extract_show_name_from_episode(name: str) -> str:
    match = EPISODE_PATTERN.search(name)
    if not match:
        return normalize_title(name, "Serie")
    prefix = name[:match.start()]
    prefix = re.sub(r"[\s._-]+$", "", prefix)
    return normalize_title(prefix, "Serie")


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return DEFAULT_CONFIG.copy()
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return DEFAULT_CONFIG.copy()
    config = DEFAULT_CONFIG.copy()
    config.update(data)
    if config.get("theme_mode") not in PALETTES:
        config["theme_mode"] = "hell"
    return config


def save_config(config: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")


@dataclass
class Job:
    source: str
    target: str
    media_type: str
    status: str = "Bereit"
    progress: str = "-"
    live_speed_bytes_per_sec: float = 0.0
    size_bytes: int = 0
    size_label: str = "-"
    return_code: int | None = None
    id: int = field(default_factory=int)


class DropManager:
    def __init__(self, root: tk.Tk, callback):
        self.root = root
        self.callback = callback
        self.old_wndproc = None
        self.new_wndproc = None

    def install(self):
        if os.name != "nt":
            return
        self.root.update_idletasks()
        hwnd = self.root.winfo_id()
        ctypes.windll.shell32.DragAcceptFiles(hwnd, True)
        wndproc = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p)

        def _wndproc(hwnd_value, msg, wparam, lparam):
            if msg == WM_DROPFILES:
                try:
                    dropped = self._extract_paths(wparam)
                    if dropped:
                        self.root.after(0, lambda: self.callback(dropped))
                finally:
                    ctypes.windll.shell32.DragFinish(wparam)
                return 0
            return ctypes.windll.user32.CallWindowProcW(ctypes.c_void_p(self.old_wndproc), hwnd_value, msg, wparam, lparam)

        self.new_wndproc = wndproc(_wndproc)
        set_window_long = ctypes.windll.user32.SetWindowLongPtrW
        set_window_long.restype = ctypes.c_void_p
        self.old_wndproc = set_window_long(hwnd, GWL_WNDPROC, self.new_wndproc)

    def _extract_paths(self, drop_handle):
        count = ctypes.windll.shell32.DragQueryFileW(drop_handle, 0xFFFFFFFF, None, 0)
        paths = []
        for index in range(count):
            length = ctypes.windll.shell32.DragQueryFileW(drop_handle, index, None, 0) + 1
            buffer = ctypes.create_unicode_buffer(length)
            ctypes.windll.shell32.DragQueryFileW(drop_handle, index, buffer, length)
            paths.append(buffer.value)
        return paths

class PlexTransferApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.geometry("1380x900")
        self.minsize(1120, 720)

        self.config_data = load_config()
        self.palette = PALETTES[self.config_data["theme_mode"]]
        self.font_family = self._pick_font_family()
        self.jobs: list[Job] = []
        self.job_counter = 1
        self.running = False
        self.current_log_path: Path | None = None
        self.executor = None
        self.ui_queue: queue.Queue = queue.Queue()
        self.drop_feedback_job = None
        self.context_menu = None
        self.selected_job_id: int | None = None
        self.checked_job_ids: set[int] = set()
        self.active_job_ids: set[int] = set()
        self.log_entries: list[tuple[str, bool]] = []
        self.speed_test_running = False
        self.pending_copy_after_speed_test = False
        self.current_run_started_at: float | None = None
        self.current_run_total_bytes = 0
        self.current_live_speed_bytes_per_sec = 0.0

        self.status_var = tk.StringVar(value="Bereit")
        self.status_detail_var = tk.StringVar(value="Wartet auf neue Jobs.")
        self.summary_var = tk.StringVar(value="Noch keine Kopiervorgänge gestartet.")
        self.last_action_var = tk.StringVar(value="Keine letzte Aktion.")
        self.job_meta_var = tk.StringVar(value="0 Jobs in der Liste")
        self.job_status_line_var = tk.StringVar(value="0 wartend | 0 läuft | 0 Fehler")
        self.overall_progress_text_var = tk.StringVar(value="0% abgeschlossen")
        self.eta_var = tk.StringVar(value="Geschätzte Dauer: nicht verfügbar")
        self.eta_detail_var = tk.StringVar(value="Noch kein Messwert vorhanden.")
        self.log_errors_only_var = tk.BooleanVar(value=False)

        self.settings_vars = {
            "movies_root": tk.StringVar(),
            "series_root": tk.StringVar(),
            "plex_url": tk.StringVar(),
            "plex_token": tk.StringVar(),
            "movies_section_id": tk.StringVar(),
            "series_section_id": tk.StringVar(),
            "parallel_enabled": tk.BooleanVar(),
            "auto_refresh": tk.BooleanVar(),
            "theme_mode": tk.StringVar(),
        }
        self._load_settings_draft()

        self._apply_palette(initial=True)
        self._build_shell()
        self._build_main_view()
        self._build_settings_view()
        self._show_main_view()
        self._update_status_badge()
        self._refresh_job_actions()
        self._refresh_job_list()
        self._refresh_empty_state()
        self._poll_ui_queue()

        self.drop_manager = DropManager(self, self.handle_dropped_paths)
        try:
            self.drop_manager.install()
            self.append_log("Drag & Drop ist aktiv.")
        except Exception as exc:
            self.append_log(f"Drag & Drop konnte nicht aktiviert werden: {exc}")

        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def _pick_font_family(self) -> str:
        available = set(tkfont.families(self))
        if "Segoe UI Variable" in available:
            return "Segoe UI Variable"
        if "Segoe UI" in available:
            return "Segoe UI"
        return "Arial"

    def _font(self, size: int, weight: str = "normal"):
        return ctk.CTkFont(family=self.font_family, size=size, weight=weight)

    def _apply_palette(self, initial: bool = False):
        ctk.set_appearance_mode(self.palette["appearance"])
        self.configure(fg_color=self.palette["bg"])
        self._configure_treeview_style()
        if not initial:
            self._apply_widget_palette()

    def _configure_treeview_style(self):
        style = ttk.Style()
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(
            "Plex.Treeview",
            background=self.palette["card"],
            foreground=self.palette["text"],
            fieldbackground=self.palette["card"],
            borderwidth=0,
            rowheight=34,
            font=(self.font_family, 10),
        )
        style.configure(
            "Plex.Treeview.Heading",
            background=self.palette["table_header"],
            foreground=self.palette["muted"],
            relief="flat",
            borderwidth=0,
            font=(self.font_family, 9, "bold"),
        )
        style.map(
            "Plex.Treeview",
            background=[("selected", self.palette["table_selected"])],
            foreground=[("selected", self.palette["text"])],
        )

    def _build_shell(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        self.header = ctk.CTkFrame(self, fg_color="transparent")
        self.header.grid(row=0, column=0, sticky="ew", padx=22, pady=(18, 10))
        self.header.grid_columnconfigure(0, weight=1)

        title_box = ctk.CTkFrame(self.header, fg_color="transparent")
        title_box.grid(row=0, column=0, sticky="w")
        self.title_label = ctk.CTkLabel(title_box, text="Plex Transfer", font=self._font(26, "bold"))
        self.title_label.pack(anchor="w")
        self.subtitle_label = ctk.CTkLabel(
            title_box,
            text="Lokales Windows-Tool für deinen Plex-Transfer-Workflow",
            font=self._font(11),
        )
        self.subtitle_label.pack(anchor="w", pady=(4, 0))

        header_actions = ctk.CTkFrame(self.header, fg_color="transparent")
        header_actions.grid(row=0, column=1, sticky="e")
        self.settings_button = ctk.CTkButton(
            header_actions,
            text="⚙",
            width=40,
            height=36,
            corner_radius=12,
            command=self.open_settings,
            font=self._font(16, "bold"),
        )
        self.settings_button.pack(side="left", padx=(0, 10))
        self.status_badge = ctk.CTkLabel(header_actions, textvariable=self.status_var, width=120, height=36, corner_radius=14, font=self._font(12, "bold"))
        self.status_badge.pack(side="left")

        self.content = ctk.CTkFrame(self, fg_color="transparent")
        self.content.grid(row=1, column=0, sticky="nsew", padx=22, pady=(0, 22))
        self.content.grid_columnconfigure(0, weight=1)
        self.content.grid_rowconfigure(0, weight=1)

        self.main_view = ctk.CTkFrame(self.content, fg_color="transparent")
        self.main_view.grid(row=0, column=0, sticky="nsew")
        self.main_view.grid_columnconfigure(0, weight=3)
        self.main_view.grid_columnconfigure(1, weight=1)
        self.main_view.grid_rowconfigure(0, weight=1)

        self.settings_view = ctk.CTkScrollableFrame(
            self.content,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=self.palette["scroll"],
            scrollbar_button_hover_color=self.palette["scroll_hover"],
        )
        self.settings_view.grid(row=0, column=0, sticky="nsew")
        self.settings_view.grid_columnconfigure(0, weight=1)
    def _create_card(self, parent, title: str, subtitle: str | None = None):
        card = ctk.CTkFrame(parent, corner_radius=18, border_width=1)
        card.grid_columnconfigure(0, weight=1)
        header = ctk.CTkFrame(card, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=18, pady=(16, 8))
        header.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(header, text=title, font=self._font(14, "bold")).grid(row=0, column=0, sticky="w")
        if subtitle:
            ctk.CTkLabel(header, text=subtitle, font=self._font(10)).grid(row=1, column=0, sticky="w", pady=(3, 0))
        body = ctk.CTkFrame(card, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 18))
        body.grid_columnconfigure(0, weight=1)
        return card, body

    def _make_secondary_button(self, parent, text, command):
        return ctk.CTkButton(parent, text=text, command=command, height=40, corner_radius=12, border_width=1, font=self._font(11, "bold"))

    def _make_primary_button(self, parent, text, command):
        return ctk.CTkButton(parent, text=text, command=command, height=42, corner_radius=12, font=self._font(11, "bold"))

    def _make_entry(self, parent, variable, show=None):
        return ctk.CTkEntry(parent, textvariable=variable, show=show, height=38, corner_radius=12, border_width=1, font=self._font(11))

    def _build_main_view(self):
        self.main_left_scroll = ctk.CTkScrollableFrame(
            self.main_view,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=self.palette["scroll"],
            scrollbar_button_hover_color=self.palette["scroll_hover"],
        )
        self.main_left_scroll.grid(row=0, column=0, sticky="nsew", padx=(0, 16))
        left = self.main_left_scroll
        left.grid_columnconfigure(0, weight=1)

        right = ctk.CTkFrame(self.main_view, fg_color="transparent")
        right.grid(row=0, column=1, sticky="nsew")
        right.grid_columnconfigure(0, weight=1)

        self.actions_card, actions_body = self._create_card(left, "Aktionen", "Medien hinzufügen, per Drag & Drop aufnehmen und Kopieren starten")
        self.actions_card.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        for col in range(3):
            actions_body.grid_columnconfigure(col, weight=1)
        self._make_secondary_button(actions_body, "Film auswählen", self.select_movie).grid(row=0, column=0, sticky="ew", padx=(0, 8), pady=(0, 10))
        self._make_secondary_button(actions_body, "Serie auswählen", self.select_series).grid(row=0, column=1, sticky="ew", padx=4, pady=(0, 10))
        self._make_secondary_button(actions_body, "Mehrere Dateien/Ordner auswählen", self.select_multiple).grid(row=0, column=2, sticky="ew", padx=(8, 0), pady=(0, 10))
        action_row = ctk.CTkFrame(actions_body, fg_color="transparent")
        action_row.grid(row=1, column=0, columnspan=3, sticky="ew")
        for col in range(3):
            action_row.grid_columnconfigure(col, weight=1)
        self._make_primary_button(action_row, "Kopiervorgang starten", self.start_copy).grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self.logs_button = self._make_secondary_button(action_row, "Logs öffnen", self.open_logs)
        self.logs_button.grid(row=0, column=1, sticky="ew", padx=4)
        self.plex_refresh_button = self._make_secondary_button(action_row, "Plex Refresh", self.manual_refresh)
        self.plex_refresh_button.grid(row=0, column=2, sticky="ew", padx=(8, 0))

        self.jobs_card, jobs_body = self._create_card(left, "Jobs", "Quelle, Ziel, Typ, Status und Fortschritt im Überblick")
        self.jobs_card.grid(row=1, column=0, sticky="nsew", pady=(0, 14))
        jobs_body.grid_rowconfigure(4, weight=1)

        meta_row = ctk.CTkFrame(jobs_body, fg_color="transparent")
        meta_row.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        meta_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(meta_row, textvariable=self.job_meta_var, font=self._font(10)).grid(row=0, column=0, sticky="w")
        ctk.CTkLabel(meta_row, textvariable=self.job_status_line_var, font=self._font(10)).grid(row=0, column=1, sticky="e")

        self.drop_zone = ctk.CTkFrame(jobs_body, corner_radius=14, border_width=1)
        self.drop_zone.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        self.drop_zone.grid_columnconfigure(0, weight=1)
        self.drop_title = ctk.CTkLabel(self.drop_zone, text="Drop-Zone", font=self._font(12, "bold"))
        self.drop_title.grid(row=0, column=0, sticky="w", padx=14, pady=(12, 2))
        self.drop_text = ctk.CTkLabel(self.drop_zone, text="Datei hierher ziehen = Film\nOrdner hierher ziehen = Serie", font=self._font(10), justify="left")
        self.drop_text.grid(row=1, column=0, sticky="w", padx=14, pady=(0, 12))

        self.manage_separator = ctk.CTkLabel(jobs_body, text="Job-Aktionen", font=self._font(10, "bold"))
        self.manage_separator.grid(row=2, column=0, sticky="w", pady=(2, 6))

        manage_row = ctk.CTkFrame(jobs_body, fg_color="transparent")
        manage_row.grid(row=3, column=0, sticky="ew", pady=(0, 12))
        for col in range(4):
            manage_row.grid_columnconfigure(col, weight=1)
        self.move_up_button = self._make_secondary_button(manage_row, "Nach oben", self.move_job_up)
        self.move_up_button.grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self.move_down_button = self._make_secondary_button(manage_row, "Nach unten", self.move_job_down)
        self.move_down_button.grid(row=0, column=1, sticky="ew", padx=6)
        self.remove_button = self._make_secondary_button(manage_row, "Entfernen", self.remove_selected_job)
        self.remove_button.grid(row=0, column=2, sticky="ew", padx=6)
        self.clear_button = self._make_secondary_button(manage_row, "Alle entfernen", self.clear_all_jobs)
        self.clear_button.grid(row=0, column=3, sticky="ew", padx=(6, 0))

        table_shell = ctk.CTkFrame(jobs_body, corner_radius=14, border_width=1)
        table_shell.grid(row=4, column=0, sticky="nsew")
        table_shell.grid_rowconfigure(0, weight=1)
        table_shell.grid_columnconfigure(0, weight=1)
        self.job_tree = ttk.Treeview(table_shell, columns=("pick", "source", "target", "type", "status", "progress", "size"), show="headings", selectmode="browse", style="Plex.Treeview")
        for name, heading, width, anchor, stretch in (
            ("pick", "X", 46, "center", False),
            ("source", "Quelle", 250, "w", True),
            ("target", "Ziel", 270, "w", True),
            ("type", "Typ", 90, "center", False),
            ("status", "Status", 120, "center", False),
            ("progress", "Fortschritt", 110, "center", False),
            ("size", "Größe", 96, "center", False),
        ):
            self.job_tree.heading(name, text=heading)
            self.job_tree.column(name, width=width, anchor=anchor, stretch=stretch)
        self.job_tree.grid(row=0, column=0, sticky="nsew", padx=(10, 0), pady=10)
        tree_scroll = ctk.CTkScrollbar(table_shell, command=self.job_tree.yview, fg_color="transparent")
        tree_scroll.grid(row=0, column=1, sticky="ns", padx=(8, 10), pady=10)
        tree_scroll_x = ctk.CTkScrollbar(table_shell, command=self.job_tree.xview, orientation="horizontal", fg_color="transparent")
        tree_scroll_x.grid(row=1, column=0, sticky="ew", padx=(10, 0), pady=(0, 10))
        self.job_tree.configure(yscrollcommand=tree_scroll.set)
        self.job_tree.configure(xscrollcommand=tree_scroll_x.set)
        self.job_tree.bind("<<TreeviewSelect>>", self.on_tree_select)
        self.job_tree.bind("<Button-1>", self.on_tree_click)
        self.job_tree.bind("<Button-3>", self.open_tree_context_menu)
        self.job_tree.bind("<Double-1>", self.open_selected_source)
        self.jobs_empty_state = ctk.CTkFrame(table_shell, corner_radius=16, fg_color="transparent")
        self.jobs_empty_state.place(relx=0.5, rely=0.5, anchor="center")
        self.jobs_empty_title = ctk.CTkLabel(self.jobs_empty_state, text="Noch keine Jobs", font=self._font(14, "bold"))
        self.jobs_empty_title.pack(anchor="center")
        self.jobs_empty_text = ctk.CTkLabel(self.jobs_empty_state, text="Füge einen Film oder Serienordner hinzu oder nutze die Drop-Zone.", font=self._font(11), justify="center")
        self.jobs_empty_text.pack(anchor="center", pady=(6, 0))

        self.log_card, log_body = self._create_card(left, "Laufendes Log", "Robocopy-Ausgabe und Systemmeldungen")
        self.log_card.grid(row=2, column=0, sticky="nsew")
        log_body.grid_rowconfigure(1, weight=1)
        log_header = ctk.CTkFrame(log_body, fg_color="transparent")
        log_header.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        log_header.grid_columnconfigure(0, weight=1)
        self.log_errors_toggle = ctk.CTkCheckBox(log_header, text="Nur Fehler anzeigen", variable=self.log_errors_only_var, command=self.refresh_log_view)
        self.log_errors_toggle.grid(row=0, column=1, sticky="e")
        log_font = "Cascadia Mono" if "Cascadia Mono" in set(tkfont.families(self)) else "Consolas"
        self.log_box = ctk.CTkTextbox(log_body, border_width=1, corner_radius=14, font=(log_font, 10), wrap="word")
        self.log_box.grid(row=1, column=0, sticky="nsew")
        self.log_box.configure(state="disabled")

        self.status_card, status_body = self._create_card(right, "Status", "Gesamtstatus, Fortschritt und letzte Aktion")
        self.status_card.grid(row=0, column=0, sticky="new")
        ctk.CTkLabel(status_body, textvariable=self.status_detail_var, font=self._font(12, "bold"), justify="left").grid(row=0, column=0, sticky="w", pady=(0, 12))

        self.eta_shell = ctk.CTkFrame(status_body, corner_radius=12, border_width=1)
        self.eta_shell.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        self.eta_shell.grid_columnconfigure(0, weight=1)
        self.eta_title_label = ctk.CTkLabel(self.eta_shell, textvariable=self.eta_var, font=self._font(10, "bold"), justify="left", anchor="w")
        self.eta_title_label.grid(row=0, column=0, sticky="w", padx=12, pady=(10, 4))
        self.eta_detail_label = ctk.CTkLabel(self.eta_shell, textvariable=self.eta_detail_var, font=self._font(10), justify="left", anchor="w", wraplength=320)
        self.eta_detail_label.grid(row=1, column=0, sticky="w", padx=12, pady=(0, 8))
        self.speed_test_button = self._make_secondary_button(self.eta_shell, "Geschwindigkeit testen", self.run_speed_test)
        self.speed_test_button.configure(height=34)
        self.speed_test_button.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 10))

        self.active_progress_rows: list[dict[str, object]] = []
        active_progress_shell = ctk.CTkFrame(status_body, fg_color="transparent")
        active_progress_shell.grid(row=2, column=0, sticky="ew")
        active_progress_shell.grid_columnconfigure(0, weight=1)
        for idx in range(2):
            row = ctk.CTkFrame(active_progress_shell, corner_radius=12, border_width=1, fg_color=self.palette["card_soft"], border_color=self.palette["border"])
            row.grid(row=idx, column=0, sticky="ew", pady=(0, 8 if idx == 0 else 0))
            row.grid_columnconfigure(0, weight=1)
            title = ctk.CTkLabel(row, text="", font=self._font(10, "bold"), justify="left", anchor="w", text_color=self.palette["text"])
            title.grid(row=0, column=0, sticky="w", padx=12, pady=(10, 4))
            bar = ctk.CTkProgressBar(row, height=12, corner_radius=999, fg_color=self.palette["primary_soft"], progress_color=self.palette["primary"])
            bar.grid(row=1, column=0, sticky="ew", padx=12)
            bar.set(0)
            percent = ctk.CTkLabel(row, text="0%", font=self._font(10), justify="left", anchor="w", text_color=self.palette["muted"])
            percent.grid(row=2, column=0, sticky="w", padx=12, pady=(6, 10))
            row.grid_remove()
            self.active_progress_rows.append({"frame": row, "title": title, "bar": bar, "percent": percent})

        self.overall_progress_label = ctk.CTkLabel(status_body, text="Gesamtfortschritt", font=self._font(10, "bold"), justify="left", text_color=self.palette["muted"])
        self.overall_progress_label.grid(row=3, column=0, sticky="w", pady=(14, 6))
        self.overall_progress = ctk.CTkProgressBar(status_body, height=14, corner_radius=999, fg_color=self.palette["primary_soft"], progress_color=self.palette["primary"])
        self.overall_progress.grid(row=4, column=0, sticky="ew")
        self.overall_progress.set(0)
        self.overall_progress_text_label = ctk.CTkLabel(status_body, textvariable=self.overall_progress_text_var, font=self._font(10), justify="left", text_color=self.palette["muted"])
        self.overall_progress_text_label.grid(row=5, column=0, sticky="w", pady=(6, 10))
        self.summary_label = ctk.CTkLabel(status_body, textvariable=self.summary_var, font=self._font(10), justify="left", wraplength=320, text_color=self.palette["muted"])
        self.summary_label.grid(row=6, column=0, sticky="w", pady=(0, 12))
        metrics = ctk.CTkFrame(status_body, fg_color="transparent")
        metrics.grid(row=7, column=0, sticky="ew", pady=(0, 12))
        metrics.grid_columnconfigure(0, weight=1)
        metrics.grid_columnconfigure(1, weight=1)
        self._build_metric(metrics, "Gesamtstatus", self.status_var, 0, 0)
        self._build_metric(metrics, "Fortschritt", self.job_meta_var, 0, 1)
        self._build_metric(metrics, "Letzte Aktion", self.last_action_var, 1, 0, 2)
    def _build_settings_view(self):
        top = ctk.CTkFrame(self.settings_view, fg_color="transparent")
        top.grid(row=0, column=0, sticky="ew", padx=6, pady=(6, 10))
        top.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(top, text="Einstellungen", font=self._font(24, "bold")).grid(row=0, column=0, sticky="w")
        ctk.CTkLabel(top, text="Änderungen gelten erst nach dem Speichern.", font=self._font(11)).grid(row=1, column=0, sticky="w", pady=(4, 0))

        controls = ctk.CTkFrame(self.settings_view, fg_color="transparent")
        controls.grid(row=1, column=0, sticky="ew", padx=6, pady=(0, 16))
        controls.grid_columnconfigure(0, weight=1)
        controls.grid_columnconfigure(1, weight=1)
        self._make_primary_button(controls, "Einstellungen speichern", self.save_settings_and_return).grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self._make_secondary_button(controls, "Zurück", self.discard_settings_and_return).grid(row=0, column=1, sticky="ew", padx=(8, 0))

        self.settings_panels = []
        for idx, (title, subtitle) in enumerate((
            ("Ziele", "Pfade für Filme und Serien"),
            ("Plex", "Serverdaten und Bibliotheksbereiche"),
            ("Parallelität", "Steuerung der Kopierausführung"),
            ("Darstellung", "Helles oder dunkles Erscheinungsbild"),
        )):
            card, body = self._create_card(self.settings_view, title, subtitle)
            card.grid(row=idx + 2, column=0, sticky="ew", padx=6, pady=(0, 14))
            self.settings_panels.append((card, body))

        _, body = self.settings_panels[0]
        self._add_settings_field(body, "Movies Root", self.settings_vars["movies_root"], 0)
        self._add_settings_field(body, "Series Root", self.settings_vars["series_root"], 1)

        _, body = self.settings_panels[1]
        self._add_settings_field(body, "Plex Base URL", self.settings_vars["plex_url"], 0)
        self._add_settings_field(body, "Plex Token", self.settings_vars["plex_token"], 1, show="*")
        self._add_settings_field(body, "Movies Section ID", self.settings_vars["movies_section_id"], 2)
        self._add_settings_field(body, "Series Section ID", self.settings_vars["series_section_id"], 3)
        self.auto_refresh_check = ctk.CTkCheckBox(body, text="Nach erfolgreichem Kopieren Plex-Refresh auslösen", variable=self.settings_vars["auto_refresh"], font=self._font(11))
        self.auto_refresh_check.grid(row=9, column=0, sticky="w", pady=(12, 0))

        _, body = self.settings_panels[2]
        self.parallel_switch = ctk.CTkSegmentedButton(body, values=["Seriell", "Parallel (max. 2 Jobs)"], command=self.on_parallel_segment_changed)
        self.parallel_switch.grid(row=0, column=0, sticky="ew")

        _, body = self.settings_panels[3]
        self.theme_switch = ctk.CTkSegmentedButton(body, values=["Hell", "Dunkel"], command=self.on_theme_segment_changed)
        self.theme_switch.grid(row=0, column=0, sticky="ew")
        ctk.CTkLabel(body, text="Das ausgewählte Theme wird erst nach dem Speichern aktiv.", font=self._font(10)).grid(row=1, column=0, sticky="w", pady=(10, 0))

        self.context_menu = tk.Menu(self, tearoff=0)
        self.context_menu.add_command(label="Nach oben", command=self.move_job_up)
        self.context_menu.add_command(label="Nach unten", command=self.move_job_down)
        self.context_menu.add_separator()
        self.context_menu.add_command(label="Entfernen", command=self.remove_selected_job)
        self.context_menu.add_command(label="Im Explorer öffnen", command=self.open_selected_source)
        self.context_menu.add_command(label="Ziel öffnen", command=self.open_selected_target)
        self.context_menu.add_command(label="Pfad kopieren", command=self.copy_selected_path)
        self.context_menu.add_command(label="Alle entfernen", command=self.clear_all_jobs)
    def _add_settings_field(self, parent, label_text, variable, row, show=None):
        ctk.CTkLabel(parent, text=label_text, font=self._font(10)).grid(row=row * 2, column=0, sticky="w", pady=(0 if row == 0 else 12, 4))
        self._make_entry(parent, variable, show=show).grid(row=row * 2 + 1, column=0, sticky="ew")

    def _build_metric(self, parent, title, variable, row, column, colspan=1):
        padx = (0, 8) if column == 0 and colspan == 1 else (0, 0)
        card = ctk.CTkFrame(parent, corner_radius=12, border_width=1)
        card.grid(row=row, column=column, columnspan=colspan, sticky="ew", padx=padx, pady=(0, 8))
        card.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(card, text=title, font=self._font(9, "bold")).grid(row=0, column=0, sticky="w", padx=12, pady=(10, 2))
        ctk.CTkLabel(card, textvariable=variable, font=self._font(11), justify="left", wraplength=320).grid(row=1, column=0, sticky="w", padx=12, pady=(0, 10))

    def _truncate_label(self, value: str, max_length: int = 40) -> str:
        if len(value) <= max_length:
            return value
        return value[: max_length - 3].rstrip() + "..."

    def _progress_to_fraction(self, progress: str) -> float:
        match = re.search(r"(\d{1,3}(?:\.\d+)?)%", progress or "")
        if not match:
            return 0.0
        try:
            value = float(match.group(1))
        except ValueError:
            return 0.0
        return max(0.0, min(1.0, value / 100))

    def _refresh_active_progress_rows(self):
        active_jobs = [job for job in self.jobs if job.id in self.active_job_ids][:2]
        for index, widget_row in enumerate(self.active_progress_rows):
            if index >= len(active_jobs):
                widget_row["frame"].grid_remove()
                continue
            job = active_jobs[index]
            job_name = Path(job.source).name or job.source
            progress_value = job.progress if job.progress not in {"", "-"} else "0%"
            widget_row["title"].configure(text=self._truncate_label(job_name))
            widget_row["bar"].set(self._progress_to_fraction(progress_value))
            widget_row["percent"].configure(text=progress_value)
            widget_row["frame"].grid()

    def _extract_speed(self, line: str) -> float | None:
        normalized = line.replace("\xa0", " ")
        if not any(token in normalized.lower() for token in ("bytes/sek", "bytes/sec")):
            return None
        match = re.search(r"(?:geschwindigkeit|speed)\s*:\s*([\d\s.,]+)\s*bytes/(?:sek|sec)", normalized, re.IGNORECASE)
        if not match:
            return None
        digits_only = re.sub(r"[^\d]", "", match.group(1))
        if not digits_only:
            return None
        try:
            speed = float(digits_only)
        except ValueError:
            return None
        return speed if speed > 0 else None

    def _current_live_speed(self) -> float:
        return sum(
            max(job.live_speed_bytes_per_sec, 0.0)
            for job in self.jobs
            if job.id in self.active_job_ids
        )

    def _get_measured_speed(self) -> float:
        try:
            return float(self.config_data.get("last_measured_bytes_per_sec", 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def _store_measured_speed(self, bytes_per_sec: float, source: str):
        if bytes_per_sec <= 0:
            return
        self.config_data["last_measured_bytes_per_sec"] = float(bytes_per_sec)
        self.config_data["last_measured_at"] = datetime.now().isoformat(timespec="seconds")
        self.config_data["last_measured_source"] = source
        save_config(self.config_data)

    def _format_measurement_note(self) -> str:
        speed = self._get_measured_speed()
        if speed <= 0:
            return "Noch kein Messwert vorhanden."
        source = str(self.config_data.get("last_measured_source", "") or "run")
        measured_at = str(self.config_data.get("last_measured_at", "") or "")
        source_label = "letzter echter Lauf" if source == "run" else "1-GB-Test"
        if measured_at:
            return f"Basis: {source_label} · {format_speed(speed)} · {measured_at.replace('T', ' ')}"
        return f"Basis: {source_label} · {format_speed(speed)}"

    def _update_eta_display(self):
        total_size = sum(job.size_bytes for job in self.jobs if job.status not in {"Kopiert", "Übersprungen"})
        if self.speed_test_running:
            self.eta_var.set("Geschätzte Dauer: Messung läuft")
            self.eta_detail_var.set("Die NAS-Geschwindigkeit wird gerade ermittelt.")
        elif self.running:
            live_speed = self._current_live_speed()
            if live_speed > 0:
                self.eta_var.set(f"Aktuelle Geschwindigkeit: {format_speed(live_speed)}")
                self.eta_detail_var.set("Live aus robocopy gelesen.")
            else:
                self.eta_var.set("Aktuelle Geschwindigkeit: wird ermittelt")
                self.eta_detail_var.set("Warte auf erste robocopy-Geschwindigkeitsdaten.")
        elif not self.jobs:
            self.eta_var.set("Geschätzte Dauer: nicht verfügbar")
            self.eta_detail_var.set("Füge zuerst Jobs hinzu.")
        elif total_size <= 0:
            self.eta_var.set("Geschätzte Dauer: nichts offen")
            self.eta_detail_var.set("Alle aktuellen Jobs sind bereits abgeschlossen oder übersprungen.")
        else:
            speed = self._get_measured_speed()
            if speed > 0:
                self.eta_var.set(f"Geschätzte Dauer: {format_eta(total_size / speed)}")
                self.eta_detail_var.set(self._format_measurement_note())
            else:
                self.eta_var.set("Geschätzte Dauer: nicht verfügbar")
                self.eta_detail_var.set("Noch kein Messwert vorhanden. Nutze „Geschwindigkeit testen“.")
        if hasattr(self, "speed_test_button"):
            self.speed_test_button.configure(state="disabled" if self.running or self.speed_test_running else "normal")

    def _pick_probe_root(self) -> Path | None:
        for key in ("movies_root", "series_root"):
            raw = str(self.config_data.get(key, "")).strip()
            if not raw:
                continue
            probe_root = Path(raw).expanduser()
            if probe_root.exists():
                return probe_root
        return None

    def _offer_speed_test_before_start(self) -> str:
        answer = messagebox.askyesnocancel(
            APP_NAME,
            "Es gibt noch keinen gemessenen Geschwindigkeitswert.\n\n"
            "Möchtest du jetzt einen 1-GB-Testtransfer für eine bessere Zeit-Schätzung ausführen?\n\n"
            "Ja = Test jetzt ausführen\n"
            "Nein = ohne Messung fortfahren\n"
            "Abbrechen = Start abbrechen",
        )
        if answer is None:
            return "cancel"
        return "test" if answer else "skip"

    def run_speed_test(self):
        self._start_speed_test(auto_continue=False)

    def _start_speed_test(self, auto_continue: bool):
        if self.running or self.speed_test_running:
            return
        if not self.validate_roots():
            return
        probe_root = self._pick_probe_root()
        if probe_root is None:
            messagebox.showerror(APP_NAME, "Kein erreichbares Ziel für den Geschwindigkeitstest gefunden.")
            return
        self.speed_test_running = True
        self.pending_copy_after_speed_test = auto_continue
        self.last_action_var.set("Geschwindigkeitstest gestartet.")
        self.append_log("Geschwindigkeitstest gestartet.", save_to_file=False)
        self._update_eta_display()
        threading.Thread(target=self._run_speed_test, args=(probe_root,), daemon=True).start()

    def _run_speed_test(self, probe_root: Path):
        probe_size = 1024 * 1024 * 1024
        local_dir = BASE_DIR / "tmp_probe"
        target_dir = probe_root / "_PlexTransferSpeedProbe"
        source_file = local_dir / "plex_transfer_probe_1gb.bin"
        try:
            ensure_directory(local_dir)
            ensure_directory(target_dir)
            with source_file.open("wb") as handle:
                handle.truncate(probe_size)
            command = [
                "robocopy",
                str(local_dir),
                str(target_dir),
                source_file.name,
                "/MT:32",
                "/J",
                "/R:1",
                "/W:1",
                "/Z",
                "/FFT",
                "/TEE",
            ]
            self.ui_queue.put(("log", ("Starte 1-GB-Geschwindigkeitstest.", False)))
            started_at = time.perf_counter()
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            if process.stdout:
                for line in process.stdout:
                    cleaned = line.rstrip()
                    if cleaned:
                        is_error = "error" in cleaned.lower() or "fehler" in cleaned.lower()
                        self.ui_queue.put(("log", (f"Speed-Test: {cleaned}", is_error)))
            return_code = process.wait()
            duration = max(time.perf_counter() - started_at, 0.001)
            if return_code >= 8:
                raise RuntimeError(f"robocopy fehlgeschlagen (Code {return_code})")
            measured_bps = probe_size / duration
            self.ui_queue.put(("speed_test_done", {"bytes_per_sec": measured_bps, "duration": duration}))
        except Exception as exc:
            self.ui_queue.put(("speed_test_failed", str(exc)))
        finally:
            for cleanup_path in (source_file, target_dir / source_file.name):
                try:
                    if cleanup_path.exists():
                        cleanup_path.unlink()
                except OSError:
                    pass
            try:
                if target_dir.exists():
                    target_dir.rmdir()
            except OSError:
                pass
            try:
                if local_dir.exists():
                    local_dir.rmdir()
            except OSError:
                pass

    def _apply_widget_palette(self):
        p = self.palette
        self.settings_button.configure(fg_color=p["card_soft"], hover_color=p["primary_soft"], text_color=p["text"], border_color=p["border"], border_width=1)
        self.title_label.configure(text_color=p["text"])
        self.subtitle_label.configure(text_color=p["muted"])
        self.header.configure(fg_color="transparent")
        self.content.configure(fg_color="transparent")
        self.main_view.configure(fg_color="transparent")
        self.main_left_scroll.configure(fg_color="transparent", scrollbar_button_color=p["scroll"], scrollbar_button_hover_color=p["scroll_hover"])
        self.settings_view.configure(fg_color="transparent", scrollbar_button_color=p["scroll"], scrollbar_button_hover_color=p["scroll_hover"])

        for card in (self.actions_card, self.jobs_card, self.log_card, self.status_card):
            card.configure(fg_color=p["card"], border_color=p["border"])
        self.drop_zone.configure(fg_color=p["drop"], border_color=p["border"])
        self.drop_title.configure(text_color=p["text"])
        self.drop_text.configure(text_color=p["muted"])
        self.manage_separator.configure(text_color=p["muted"])
        self.log_errors_toggle.configure(text_color=p["text"], fg_color=p["primary"], hover_color=p["primary_hover"], border_color=p["border"])
        self.log_box.configure(fg_color=p["log_bg"], text_color=p["log_fg"], border_color="#1e2937", scrollbar_button_color=p["scroll"], scrollbar_button_hover_color=p["scroll_hover"])
        self.eta_shell.configure(fg_color=p["card_soft"], border_color=p["border"])
        self.eta_title_label.configure(text_color=p["text"])
        self.eta_detail_label.configure(text_color=p["muted"])
        self.speed_test_button.configure(state="disabled" if self.running or self.speed_test_running else "normal")
        for progress_row in self.active_progress_rows:
            progress_row["frame"].configure(fg_color=p["card_soft"], border_color=p["border"])
            progress_row["title"].configure(text_color=p["text"])
            progress_row["bar"].configure(fg_color=p["primary_soft"], progress_color=p["primary"])
            progress_row["percent"].configure(text_color=p["muted"])
        self.overall_progress_label.configure(text_color=p["muted"])
        self.overall_progress.configure(fg_color=p["primary_soft"], progress_color=p["primary"])
        self.overall_progress_text_label.configure(text_color=p["muted"])
        self.summary_label.configure(text_color=p["muted"])
        self.jobs_empty_title.configure(text_color=p["text"])
        self.jobs_empty_text.configure(text_color=p["muted"])

        for panel, _ in self.settings_panels:
            panel.configure(fg_color=p["card"], border_color=p["border"])
        self.auto_refresh_check.configure(text_color=p["text"], fg_color=p["primary"], hover_color=p["primary_hover"], border_color=p["border"])
        self.parallel_switch.configure(fg_color=p["card_soft"], selected_color=p["primary"], selected_hover_color=p["primary_hover"], unselected_color=p["card_soft"], unselected_hover_color=p["surface"], text_color=p["text"])
        self.theme_switch.configure(fg_color=p["card_soft"], selected_color=p["primary"], selected_hover_color=p["primary_hover"], unselected_color=p["card_soft"], unselected_hover_color=p["surface"], text_color=p["text"])
        self._refresh_job_actions()
        self._update_status_badge()
        self._configure_treeview_style()
        self._refresh_job_list(preserve_selection=True)
    def _load_settings_draft(self):
        for key, var in self.settings_vars.items():
            var.set(self.config_data[key])

    def _show_main_view(self):
        self.settings_view.grid_remove()
        self.main_view.grid()
        self.settings_button.configure(state="normal")

    def _show_settings_view(self):
        self.main_view.grid_remove()
        self.settings_view.grid()
        self.settings_button.configure(state="disabled")

    def open_settings(self):
        self._load_settings_draft()
        self.parallel_switch.set("Parallel (max. 2 Jobs)" if self.settings_vars["parallel_enabled"].get() else "Seriell")
        self.theme_switch.set("Dunkel" if self.settings_vars["theme_mode"].get() == "dunkel" else "Hell")
        self._show_settings_view()

    def save_settings_and_return(self):
        updated_config = self.config_data.copy()
        updated_config.update({
            "movies_root": self.settings_vars["movies_root"].get().strip(),
            "series_root": self.settings_vars["series_root"].get().strip(),
            "plex_url": self.settings_vars["plex_url"].get().strip(),
            "plex_token": self.settings_vars["plex_token"].get().strip(),
            "movies_section_id": self.settings_vars["movies_section_id"].get().strip(),
            "series_section_id": self.settings_vars["series_section_id"].get().strip(),
            "parallel_enabled": bool(self.settings_vars["parallel_enabled"].get()),
            "auto_refresh": bool(self.settings_vars["auto_refresh"].get()),
            "theme_mode": self.settings_vars["theme_mode"].get(),
        })
        self.config_data = updated_config
        save_config(self.config_data)
        self.palette = PALETTES[self.config_data["theme_mode"]]
        self._apply_palette()
        self.last_action_var.set("Einstellungen gespeichert.")
        self.append_log("Einstellungen gespeichert.")
        self._show_main_view()

    def discard_settings_and_return(self):
        self._load_settings_draft()
        self._show_main_view()

    def on_parallel_segment_changed(self, value: str):
        self.settings_vars["parallel_enabled"].set(value.startswith("Parallel"))

    def on_theme_segment_changed(self, value: str):
        self.settings_vars["theme_mode"].set("dunkel" if value == "Dunkel" else "hell")

    def append_log(self, message: str, save_to_file: bool = False, is_error: bool | None = None):
        if is_error is None:
            lowered = message.lower()
            is_error = any(token in lowered for token in ("fehler", "fehlgeschlagen", "abgebrochen", "konnte nicht", "traceback", "exception"))
        timestamped = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
        self.log_entries.append((timestamped, bool(is_error)))
        self.refresh_log_view()
        if save_to_file and self.current_log_path:
            ensure_directory(self.current_log_path.parent)
            with self.current_log_path.open("a", encoding="utf-8") as handle:
                handle.write(timestamped + "\n")

    def refresh_log_view(self):
        show_only_errors = self.log_errors_only_var.get()
        visible_entries = [entry for entry in self.log_entries if (entry[1] if show_only_errors else True)]
        self.log_box.configure(state="normal")
        self.log_box.delete("1.0", "end")
        for message, _is_error in visible_entries:
            self.log_box.insert("end", message + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def open_logs(self):
        ensure_directory(LOG_DIR)
        os.startfile(str(LOG_DIR))

    def select_movie(self):

        path = filedialog.askopenfilename(
            title="Film auswählen",
            filetypes=[("Videodateien", "*.mkv *.mp4 *.avi *.mov *.wmv *.m4v *.ts *.mpg *.mpeg"), ("Alle Dateien", "*.*")],
        )
        if path:
            self.add_path_as_job(Path(path), forced_type="Film")

    def select_series(self):
        path = filedialog.askdirectory(title="Serienordner auswählen")
        if path:
            self.add_path_as_job(Path(path), forced_type="Serie")

    def select_multiple(self):
        chooser = ctk.CTkToplevel(self)
        chooser.title("Mehrere Medien hinzufügen")
        chooser.transient(self)
        chooser.grab_set()
        chooser.resizable(False, False)
        chooser.configure(fg_color=self.palette["bg"])
        shell = ctk.CTkFrame(chooser, corner_radius=18, border_width=1)
        shell.pack(fill="both", expand=True, padx=18, pady=18)
        shell.configure(fg_color=self.palette["card"], border_color=self.palette["border"])
        ctk.CTkLabel(shell, text="Mehrere Medien hinzufügen", font=self._font(14, "bold"), text_color=self.palette["text"]).pack(anchor="w", padx=18, pady=(18, 4))
        ctk.CTkLabel(shell, text="Dateien und Ordner können nacheinander hinzugefügt werden.", font=self._font(10), text_color=self.palette["muted"]).pack(anchor="w", padx=18, pady=(0, 16))

        def add_files():
            paths = filedialog.askopenfilenames(title="Mehrere Filme auswählen", filetypes=[("Videodateien", "*.mkv *.mp4 *.avi *.mov *.wmv *.m4v *.ts *.mpg *.mpeg"), ("Alle Dateien", "*.*")])
            for path in paths:
                self.add_path_as_job(Path(path))

        def add_folder():
            while True:
                path = filedialog.askdirectory(title="Serienordner auswählen")
                if not path:
                    break
                self.add_path_as_job(Path(path), forced_type="Serie")
                if not messagebox.askyesno(APP_NAME, "Noch einen Ordner hinzufügen?", parent=chooser):
                    break

        row = ctk.CTkFrame(shell, fg_color="transparent")
        row.pack(fill="x", padx=18, pady=(0, 18))
        for col in range(3):
            row.grid_columnconfigure(col, weight=1)
        self._make_secondary_button(row, "Dateien wählen", add_files).grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self._make_secondary_button(row, "Ordner wählen", add_folder).grid(row=0, column=1, sticky="ew", padx=6)
        self._make_primary_button(row, "Schließen", chooser.destroy).grid(row=0, column=2, sticky="ew", padx=(6, 0))

    def handle_dropped_paths(self, paths: list[str]):
        self._flash_drop_zone()
        for raw in paths:
            self.add_path_as_job(Path(raw))

    def _flash_drop_zone(self):
        self.drop_zone.configure(fg_color=self.palette["drop_active"])
        if self.drop_feedback_job:
            self.after_cancel(self.drop_feedback_job)
        self.drop_feedback_job = self.after(1300, self._reset_drop_zone)

    def _reset_drop_zone(self):
        self.drop_zone.configure(fg_color=self.palette["drop"])
        self.drop_feedback_job = None

    def add_path_as_job(self, path: Path, forced_type: str | None = None):
        if not path.exists():
            messagebox.showerror(APP_NAME, f"Pfad nicht gefunden:\n{path}")
            return
        try:
            job = self._build_job(path, forced_type)
        except ValueError as exc:
            messagebox.showerror(APP_NAME, str(exc))
            return
        self.jobs.append(job)
        self.selected_job_id = job.id
        self._refresh_job_list(preserve_selection=True)
        self._refresh_empty_state()
        self.last_action_var.set(f"Job hinzugefügt: {Path(job.source).name}")
        self.status_detail_var.set("Jobliste aktualisiert.")
        self.append_log(f"Job hinzugefügt: {job.media_type} | {job.source} -> {job.target}")

    def _build_job(self, path: Path, forced_type: str | None = None) -> Job:
        media_type = forced_type
        if media_type is None:
            if path.is_dir():
                media_type = "Serie"
            elif path.is_file() and looks_like_video(path):
                media_type = "Serie" if detect_season_number(path.stem) is not None else "Film"
            else:
                raise ValueError(f"Nicht unterstützter Pfad:\n{path}")

        if media_type == "Film":
            if not path.is_file():
                raise ValueError(f"Ein Film muss eine Videodatei sein:\n{path}")
            target_path = Path(self.config_data["movies_root"]).expanduser() / path.name
        else:
            if path.is_dir():
                show_name = normalize_title(path.name, "Serie")
                if has_season_subfolders(path):
                    target_path = Path(self.config_data["series_root"]).expanduser() / show_name
                else:
                    season = 1
                    try:
                        for child in path.iterdir():
                            if child.is_file() and looks_like_video(child):
                                season = detect_season_number(child.stem) or season
                                break
                    except OSError:
                        pass
                    target_path = Path(self.config_data["series_root"]).expanduser() / show_name / f"Season {season:02d}"
            else:
                if not path.is_file() or not looks_like_video(path):
                    raise ValueError(f"Eine Serie muss ein Ordner oder eine Episodendatei sein:\n{path}")
                season = detect_season_number(path.stem) or 1
                show_name = extract_show_name_from_episode(path.stem)
                target_path = Path(self.config_data["series_root"]).expanduser() / show_name / f"Season {season:02d}" / path.name
        size_bytes = calculate_source_size(path)
        job = Job(
            source=str(path),
            target=str(target_path),
            media_type=media_type,
            size_bytes=size_bytes,
            size_label=format_size(size_bytes),
            id=self.job_counter,
        )
        self.job_counter += 1
        return job

    def on_tree_select(self, _event=None):
        selection = self.job_tree.selection()
        self.selected_job_id = int(selection[0]) if selection else None
        self._refresh_job_actions()

    def on_tree_click(self, event):
        region = self.job_tree.identify("region", event.x, event.y)
        column = self.job_tree.identify_column(event.x)
        row = self.job_tree.identify_row(event.y)
        if region == "cell" and column == "#1" and row:
            job_id = int(row)
            if job_id in self.checked_job_ids:
                self.checked_job_ids.remove(job_id)
            else:
                self.checked_job_ids.add(job_id)
            self.job_tree.selection_set(row)
            self.job_tree.focus(row)
            self.selected_job_id = job_id
            self._refresh_job_list(preserve_selection=True)
            return "break"
        return None

    def open_tree_context_menu(self, event):
        row = self.job_tree.identify_row(event.y)
        if not row:
            return
        self.job_tree.selection_set(row)
        self.selected_job_id = int(row)
        self._refresh_job_actions()
        try:
            self.context_menu.tk_popup(event.x_root, event.y_root)
        finally:
            if self.context_menu:
                self.context_menu.grab_release()

    def _get_selected_job(self) -> Job | None:
        idx = self._job_index(self.selected_job_id)
        return self.jobs[idx] if idx is not None else None

    def _get_checked_jobs(self) -> list[Job]:
        return [job for job in self.jobs if job.id in self.checked_job_ids]

    def open_selected_source(self, _event=None):
        job = self._get_selected_job()
        if job:
            self._open_job_location(job, target=False)

    def open_selected_target(self):
        job = self._get_selected_job()
        if job:
            self._open_job_location(job, target=True)

    def copy_selected_path(self):
        job = self._get_selected_job()
        if not job:
            return
        self.clipboard_clear()
        self.clipboard_append(job.source)
        self.last_action_var.set("Quellpfad in die Zwischenablage kopiert.")
        self.append_log(f"Pfad kopiert: {job.source}")

    def _open_job_location(self, job: Job, target: bool):
        raw_path = Path(job.target if target else job.source)
        try:
            if raw_path.is_file():
                open_path = raw_path.parent
            elif raw_path.exists():
                open_path = raw_path
            elif target and raw_path.suffix:
                open_path = raw_path.parent
            else:
                open_path = raw_path
                while not open_path.exists() and open_path.parent != open_path:
                    open_path = open_path.parent
        except OSError:
            open_path = raw_path.parent if target and raw_path.suffix else raw_path
        try:
            path_exists = open_path.exists()
        except OSError:
            path_exists = False
        if not path_exists:
            messagebox.showinfo(APP_NAME, f"Pfad ist aktuell nicht erreichbar:\n{raw_path}")
            return
        os.startfile(str(open_path))
        self.last_action_var.set(f"Explorer geöffnet: {open_path.name}")

    def _refresh_job_actions(self):
        checked = bool(self.checked_job_ids)
        disabled_single = self.running or self.selected_job_id is None
        disabled_remove = self.running or (self.selected_job_id is None and not checked)
        for button in (self.move_up_button, self.move_down_button):
            button.configure(state="disabled" if disabled_single else "normal")
        self.remove_button.configure(state="disabled" if disabled_remove else "normal")
        self.clear_button.configure(state="disabled" if self.running or not self.jobs else "normal")
        if self.context_menu:
            states = {0: disabled_single, 1: disabled_single, 3: disabled_remove, 4: disabled_single, 5: disabled_single, 6: disabled_single, 7: self.running or not self.jobs}
            end_index = self.context_menu.index("end")
            if end_index is not None:
                for index, disabled in states.items():
                    if index <= end_index:
                        self.context_menu.entryconfigure(index, state="disabled" if disabled else "normal")

    def _job_index(self, job_id: int | None) -> int | None:

        if job_id is None:
            return None
        for index, job in enumerate(self.jobs):
            if job.id == job_id:
                return index
        return None

    def move_job_up(self):
        idx = self._job_index(self.selected_job_id)
        if idx is None or idx == 0 or self.running:
            return
        self.jobs[idx - 1], self.jobs[idx] = self.jobs[idx], self.jobs[idx - 1]
        self._refresh_job_list(preserve_selection=True)

    def move_job_down(self):
        idx = self._job_index(self.selected_job_id)
        if idx is None or idx == len(self.jobs) - 1 or self.running:
            return
        self.jobs[idx + 1], self.jobs[idx] = self.jobs[idx], self.jobs[idx + 1]
        self._refresh_job_list(preserve_selection=True)

    def remove_selected_job(self):
        if self.running:
            return
        selected_ids = {int(item) for item in self.job_tree.selection()}
        checked_ids = {job.id for job in self.jobs if job.id in self.checked_job_ids}
        job_ids_to_remove = checked_ids or selected_ids
        if not job_ids_to_remove and self.selected_job_id is not None:
            job_ids_to_remove = {self.selected_job_id}
        if not job_ids_to_remove:
            return
        removed_jobs = [job for job in self.jobs if job.id in job_ids_to_remove]
        first_index = next((index for index, job in enumerate(self.jobs) if job.id in job_ids_to_remove), 0)
        self.jobs = [job for job in self.jobs if job.id not in job_ids_to_remove]
        self.checked_job_ids.difference_update(job_ids_to_remove)
        self.selected_job_id = self.jobs[min(first_index, len(self.jobs) - 1)].id if self.jobs else None
        self._refresh_job_list(preserve_selection=True)
        self._refresh_empty_state()
        if len(removed_jobs) == 1:
            self.last_action_var.set(f"Job entfernt: {Path(removed_jobs[0].source).name}")
        else:
            self.last_action_var.set(f"{len(removed_jobs)} Jobs entfernt.")

    def clear_all_jobs(self):
        if self.running or not self.jobs:
            return
        if not messagebox.askyesno(APP_NAME, "Alle Jobs wirklich entfernen?"):
            return
        self.jobs.clear()
        self.checked_job_ids.clear()
        self.selected_job_id = None
        self._refresh_job_list(preserve_selection=False)
        self._refresh_empty_state()
        self.last_action_var.set("Alle Jobs entfernt.")

    def _refresh_job_list(self, preserve_selection: bool = True):
        selected = self.selected_job_id if preserve_selection else None
        for item in self.job_tree.get_children():
            self.job_tree.delete(item)
        for job in self.jobs:
            tag = f"job_{job.id}"
            checkbox = "[x]" if job.id in self.checked_job_ids else "[ ]"
            color_key = "danger" if job.status.startswith("Fehler") else JOB_COLORS.get(job.status, "muted")
            row_background = self.palette["primary_soft"] if job.id in self.active_job_ids else self.palette["card"]
            self.job_tree.tag_configure(tag, foreground=self.palette.get(color_key, self.palette["muted"]), background=row_background)
            self.job_tree.insert("", "end", iid=str(job.id), values=(checkbox, job.source, job.target, job.media_type, job.status, job.progress, job.size_label), tags=(tag,))
        if selected and str(selected) in self.job_tree.get_children():
            self.job_tree.selection_set(str(selected))
        else:
            children = self.job_tree.get_children()
            self.selected_job_id = int(children[0]) if children else None
            if self.selected_job_id is not None:
                self.job_tree.selection_set(str(self.selected_job_id))
        total = len(self.jobs)
        success = sum(1 for job in self.jobs if job.status == "Kopiert")
        skipped = sum(1 for job in self.jobs if job.status == "Übersprungen")
        failed = sum(1 for job in self.jobs if job.status.startswith("Fehler"))
        waiting = sum(1 for job in self.jobs if job.status in {"Bereit", "Wartet"})
        running = len(self.active_job_ids)
        completed = success + skipped + failed
        self.job_meta_var.set(f"{total} Jobs in der Liste")
        self.job_status_line_var.set(f"{waiting} wartend | {running} läuft | {failed} Fehler")
        if total == 0:
            self.overall_progress.set(0)
            self.overall_progress_text_var.set("0% abgeschlossen")
            self.summary_var.set("Noch keine Kopiervorgänge gestartet.")
        else:
            overall_fraction = completed / total
            self.overall_progress.set(overall_fraction)
            self.overall_progress_text_var.set(f"{round(overall_fraction * 100)}% abgeschlossen")
            self.summary_var.set(f"Erfolgreich {success} | Übersprungen {skipped} | Fehlgeschlagen {failed}")
        self._refresh_active_progress_rows()
        self._update_eta_display()
        self._refresh_job_actions()

    def _refresh_empty_state(self):
        if self.jobs:
            self.jobs_empty_state.place_forget()
        else:
            self.jobs_empty_state.place(relx=0.5, rely=0.5, anchor="center")

    def validate_roots(self) -> bool:

        movies_root = Path(self.config_data["movies_root"]).expanduser()
        series_root = Path(self.config_data["series_root"]).expanduser()
        missing = [str(path) for path in (movies_root, series_root) if not path.exists()]
        if missing:
            messagebox.showerror(APP_NAME, "Folgende Zielpfade fehlen oder das Netzlaufwerk ist nicht verbunden:\n" + "\n".join(missing))
            self._set_global_status("Fehler", "Zielpfade nicht erreichbar.")
            self.last_action_var.set("Netzlaufwerk nicht erreichbar.")
            return False
        return True

    def start_copy(self, skip_eta_prompt: bool = False):
        if self.running or self.speed_test_running:
            messagebox.showinfo(APP_NAME, "Es läuft bereits ein Kopiervorgang.")
            return
        if not self.jobs:
            messagebox.showinfo(APP_NAME, "Es sind keine Jobs vorhanden.")
            return
        if not self.validate_roots():
            return
        if not skip_eta_prompt and self._get_measured_speed() <= 0:
            decision = self._offer_speed_test_before_start()
            if decision == "cancel":
                self.last_action_var.set("Kopiervorgang abgebrochen.")
                return
            if decision == "test":
                self._start_speed_test(auto_continue=True)
                return
        if not self._show_copy_preview():
            self.last_action_var.set("Kopiervorgang abgebrochen.")
            return

        self.running = True
        self.active_job_ids.clear()
        self.current_run_started_at = time.perf_counter()
        self.current_run_total_bytes = sum(job.size_bytes for job in self.jobs if job.status not in {"Kopiert", "Übersprungen"})
        self.current_live_speed_bytes_per_sec = 0.0
        self.current_log_path = LOG_DIR / f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        ensure_directory(LOG_DIR)
        self._set_global_status("Kopiert...", "Kopiervorgang läuft.")
        self.summary_var.set("Kopieren gestartet.")
        self.last_action_var.set("Robocopy-Worker gestartet.")
        self.overall_progress.set(0)
        self.append_log("Kopiervorgang gestartet.", save_to_file=True)
        for job in self.jobs:
            if job.status not in {"Kopiert", "Übersprungen"}:
                job.status = "Wartet"
                job.progress = "0%"
                job.live_speed_bytes_per_sec = 0.0
        self._refresh_job_list(preserve_selection=True)
        self.executor = ThreadPoolExecutor(max_workers=2 if self.config_data["parallel_enabled"] else 1)
        for job in self.jobs:
            if job.status == "Wartet":
                self.executor.submit(self._run_job, job)
        threading.Thread(target=self._watch_executor, daemon=True).start()

    def _watch_executor(self):
        if self.executor:
            self.executor.shutdown(wait=True)
        self.ui_queue.put(("all_done", None))

    def _run_job(self, job: Job):
        source_path = Path(job.source)
        target_path = Path(job.target)
        self.ui_queue.put(("job_start", job.id))
        self.ui_queue.put(("job_update", (job.id, "Kopiert...", "0%")))
        self.ui_queue.put(("log", (f"Starte Job #{job.id}: {job.source} -> {job.target}", False)))
        try:
            ensure_directory(target_path.parent if job.media_type == "Film" and target_path.suffix else target_path)
            command = self._build_robocopy_command(job)
            self.ui_queue.put(("log", (f"robocopy {' '.join(command)}", False)))
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            last_progress = "0%"
            if process.stdout:
                for line in process.stdout:
                    cleaned = line.rstrip()
                    if cleaned:
                        is_error = "error" in cleaned.lower() or "fehler" in cleaned.lower()
                        self.ui_queue.put(("log", (f"Job #{job.id}: {cleaned}", is_error)))
                    progress = self._extract_progress(cleaned)
                    if progress and progress != last_progress:
                        last_progress = progress
                        self.ui_queue.put(("job_update", (job.id, "Kopiert...", progress)))
                    speed = self._extract_speed(cleaned)
                    if speed is not None:
                        self.ui_queue.put(("job_speed", (job.id, speed)))
            return_code = process.wait()
            job.return_code = return_code
            if return_code < 8:
                if return_code == 0:
                    self.ui_queue.put(("job_update", (job.id, "Übersprungen", last_progress)))
                    self.ui_queue.put(("log", (f"Job #{job.id} ohne Änderungen beendet (Code 0).", False)))
                else:
                    self.ui_queue.put(("job_update", (job.id, "Kopiert", "100%")))
                    self.ui_queue.put(("log", (f"Job #{job.id} erfolgreich abgeschlossen (Code {return_code}).", False)))
            else:
                self.ui_queue.put(("job_update", (job.id, f"Fehler ({return_code})", last_progress)))
                self.ui_queue.put(("log", (f"Job #{job.id} fehlgeschlagen (Code {return_code}).", True)))
        except Exception as exc:
            self.ui_queue.put(("job_update", (job.id, "Fehler", "-")))
            self.ui_queue.put(("log", (f"Job #{job.id} abgebrochen: {exc}", True)))
        finally:
            self.ui_queue.put(("job_speed", (job.id, 0.0)))
            self.ui_queue.put(("job_done", job.id))

    def _build_robocopy_command(self, job: Job) -> list[str]:

        source_path = Path(job.source)
        target_path = Path(job.target)
        flags = ["/MT:32", "/J", "/R:1", "/W:1", "/Z", "/FFT", "/TEE"]
        if job.media_type == "Film":
            return ["robocopy", str(source_path.parent), str(target_path.parent), source_path.name, *flags]
        return ["robocopy", str(source_path), str(target_path), "/E", *flags]

    def _extract_progress(self, line: str) -> str | None:
        match = re.search(r"(\d{1,3}(?:\.\d+)?)%", line)
        return f"{match.group(1)}%" if match else None

    def manual_refresh(self):
        if not self.config_data.get("plex_url") or not self.config_data.get("plex_token"):
            hint = "Bitte zuerst Plex-URL und Token in den Einstellungen speichern."
            self.append_log(hint, save_to_file=True, is_error=True)
            self.last_action_var.set("Plex-Zugangsdaten fehlen.")
            messagebox.showinfo(APP_NAME, hint)
            return
        movies_ok, series_ok = self._trigger_plex_refresh({"Film", "Serie"})
        if movies_ok or series_ok:
            self.append_log("Plex-Refresh erfolgreich ausgelöst.", save_to_file=True)
            self.last_action_var.set("Plex-Refresh ausgelöst.")
            self._set_global_status("Bereit", "Plex-Refresh gesendet.")
            messagebox.showinfo(APP_NAME, "Plex-Refresh wurde ausgelöst.")
        else:
            self.append_log("Plex-Refresh konnte nicht ausgelöst werden.", save_to_file=True, is_error=True)
            self.last_action_var.set("Plex-Refresh fehlgeschlagen.")
            self._set_global_status("Fehler", "Plex-Refresh fehlgeschlagen.")
            messagebox.showerror(APP_NAME, "Plex-Refresh konnte nicht ausgelöst werden.")

    def _trigger_plex_refresh(self, libraries: set[str] | None = None) -> tuple[bool, bool]:
        base_url = str(self.config_data.get("plex_url", "")).rstrip("/")
        token = str(self.config_data.get("plex_token", "")).strip()
        movies_section = str(self.config_data.get("movies_section_id", "")).strip()
        series_section = str(self.config_data.get("series_section_id", "")).strip()
        if not base_url or not token:
            return False, False
        target_libraries = libraries or {"Film", "Serie"}

        def refresh(section_id: str) -> bool:
            if not section_id:
                return False
            url = f"{base_url}/library/sections/{section_id}/refresh?X-Plex-Token={urllib.parse.quote(token)}"
            try:
                request = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(request, timeout=10) as response:
                    return 200 <= response.status < 300
            except Exception as exc:
                self.append_log(f"Plex-Refresh für Section {section_id} fehlgeschlagen: {exc}", save_to_file=True, is_error=True)
                return False

        movies_ok = refresh(movies_section) if "Film" in target_libraries else False
        series_ok = refresh(series_section) if "Serie" in target_libraries else False
        return movies_ok, series_ok

    def _poll_ui_queue(self):
        try:
            while True:
                message_type, payload = self.ui_queue.get_nowait()
                if message_type == "log":
                    message, is_error = payload
                    self.append_log(str(message), save_to_file=True, is_error=is_error)
                elif message_type == "job_update":
                    job_id, status, progress = payload
                    for job in self.jobs:
                        if job.id == job_id:
                            job.status = status
                            job.progress = progress
                            break
                    self._refresh_job_list(preserve_selection=True)
                elif message_type == "job_start":
                    self.active_job_ids.add(int(payload))
                    self._refresh_job_list(preserve_selection=True)
                elif message_type == "job_speed":
                    job_id, speed = payload
                    for job in self.jobs:
                        if job.id == int(job_id):
                            job.live_speed_bytes_per_sec = float(speed)
                            break
                    self.current_live_speed_bytes_per_sec = self._current_live_speed()
                    self._update_eta_display()
                elif message_type == "job_done":
                    self.active_job_ids.discard(int(payload))
                    for job in self.jobs:
                        if job.id == int(payload):
                            job.live_speed_bytes_per_sec = 0.0
                            break
                    self.current_live_speed_bytes_per_sec = self._current_live_speed()
                    self._refresh_job_list(preserve_selection=True)
                elif message_type == "speed_test_done":
                    bytes_per_sec = float(payload["bytes_per_sec"])
                    duration = float(payload["duration"])
                    self.speed_test_running = False
                    self._store_measured_speed(bytes_per_sec, "probe")
                    self.last_action_var.set("Geschwindigkeitstest abgeschlossen.")
                    self.append_log(f"Geschwindigkeitstest abgeschlossen: {format_speed(bytes_per_sec)} in {duration:.1f}s.", is_error=False)
                    self._refresh_job_list(preserve_selection=True)
                    if self.pending_copy_after_speed_test:
                        self.pending_copy_after_speed_test = False
                        self.after(150, lambda: self.start_copy(skip_eta_prompt=True))
                elif message_type == "speed_test_failed":
                    self.speed_test_running = False
                    self.pending_copy_after_speed_test = False
                    self.last_action_var.set("Geschwindigkeitstest fehlgeschlagen.")
                    self.append_log(f"Geschwindigkeitstest fehlgeschlagen: {payload}", is_error=True)
                    messagebox.showerror(APP_NAME, f"Geschwindigkeitstest fehlgeschlagen:\n{payload}")
                    self._refresh_job_list(preserve_selection=True)
                elif message_type == "all_done":
                    self._finish_run()
        except queue.Empty:
            pass
        self.after(150, self._poll_ui_queue)

    def _set_global_status(self, title: str, detail: str):

        self.status_var.set(title)
        self.status_detail_var.set(detail)
        self._update_status_badge()

    def _update_status_badge(self):
        style_key = STATUS_STYLES.get(self.status_var.get(), "muted")
        badge_color = self.palette.get(style_key, self.palette["muted"])
        text_color = "#ffffff" if style_key in {"primary", "success", "danger", "warning"} else self.palette["text"]
        self.status_badge.configure(fg_color=badge_color, text_color=text_color, text=self.status_var.get())

    def _finish_run(self):
        self.running = False
        self.executor = None
        self.active_job_ids.clear()
        self.current_live_speed_bytes_per_sec = 0.0
        for job in self.jobs:
            job.live_speed_bytes_per_sec = 0.0
        success = sum(1 for job in self.jobs if job.status == "Kopiert")
        skipped = sum(1 for job in self.jobs if job.status == "Übersprungen")
        failed = sum(1 for job in self.jobs if job.status.startswith("Fehler"))
        if failed:
            self._set_global_status("Fehler", "Mindestens ein Job ist fehlgeschlagen.")
        else:
            self._set_global_status("Fertig", "Alle Jobs wurden abgearbeitet.")
        self.summary_var.set(f"Erfolgreich {success} | Übersprungen {skipped} | Fehlgeschlagen {failed}")
        self.last_action_var.set("Kopiervorgang abgeschlossen.")
        self.append_log("Kopiervorgang abgeschlossen.", save_to_file=True)
        copied_bytes = sum(job.size_bytes for job in self.jobs if job.status == "Kopiert")
        if copied_bytes > 0 and self.current_run_started_at:
            duration = max(time.perf_counter() - self.current_run_started_at, 0.001)
            measured_bps = copied_bytes / duration
            self._store_measured_speed(measured_bps, "run")
            self.append_log(f"Gemessene Transfergeschwindigkeit gespeichert: {format_speed(measured_bps)}.", save_to_file=True)
        self.current_run_started_at = None
        self.current_run_total_bytes = 0
        self._refresh_job_list(preserve_selection=True)
        if self.config_data.get("auto_refresh") and success:
            affected_libraries = {job.media_type for job in self.jobs if job.status == "Kopiert"}
            movies_ok, series_ok = self._trigger_plex_refresh(affected_libraries)
            if movies_ok or series_ok:
                self.append_log("Automatischer Plex-Refresh erfolgreich ausgelöst.", save_to_file=True)
            else:
                self.append_log("Automatischer Plex-Refresh konnte nicht ausgelöst werden.", save_to_file=True, is_error=True)
        self._show_completion_dialog(success, skipped, failed)

    def _show_completion_dialog(self, success: int, skipped: int, failed: int):
        dialog = ctk.CTkToplevel(self)
        dialog.title("Kopiervorgang abgeschlossen")
        dialog.geometry("430x280")
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()
        dialog.configure(fg_color=self.palette["bg"])

        shell = ctk.CTkFrame(dialog, corner_radius=18, border_width=1, fg_color=self.palette["card"], border_color=self.palette["border"])
        shell.pack(fill="both", expand=True, padx=18, pady=18)
        shell.grid_columnconfigure(0, weight=1)

        accent_color = self.palette["success"] if failed == 0 else self.palette["danger"]
        accent_text = "OK" if failed == 0 else "!"
        message_text = "Alle Jobs wurden erfolgreich abgearbeitet." if failed == 0 else "Der Kopiervorgang ist beendet, aber mindestens ein Job ist fehlgeschlagen."

        header = ctk.CTkFrame(shell, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=18, pady=(18, 10))
        header.grid_columnconfigure(1, weight=1)
        badge = ctk.CTkLabel(header, text=accent_text, width=42, height=42, corner_radius=21, fg_color=accent_color, text_color="#ffffff", font=self._font(14, "bold"))
        badge.grid(row=0, column=0, rowspan=2, sticky="nw")
        ctk.CTkLabel(header, text="Kopiervorgang abgeschlossen", font=self._font(16, "bold"), text_color=self.palette["text"]).grid(row=0, column=1, sticky="w", padx=(12, 0))
        ctk.CTkLabel(header, text=message_text, font=self._font(10), text_color=self.palette["muted"], justify="left", wraplength=300).grid(row=1, column=1, sticky="w", padx=(12, 0), pady=(4, 0))

        stats = ctk.CTkFrame(shell, fg_color="transparent")
        stats.grid(row=1, column=0, sticky="ew", padx=18, pady=(0, 18))
        for column in range(3):
            stats.grid_columnconfigure(column, weight=1)
        for column, (label, value, color_key) in enumerate((
            ("Erfolgreich", success, "success"),
            ("Übersprungen", skipped, "warning"),
            ("Fehlgeschlagen", failed, "danger"),
        )):
            card = ctk.CTkFrame(stats, corner_radius=12, border_width=1, fg_color=self.palette["card_soft"], border_color=self.palette["border"])
            card.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 6, 0 if column == 2 else 6))
            ctk.CTkLabel(card, text=label, font=self._font(10, "bold"), text_color=self.palette["muted"]).pack(anchor="w", padx=12, pady=(12, 4))
            ctk.CTkLabel(card, text=str(value), font=self._font(18, "bold"), text_color=self.palette[color_key]).pack(anchor="w", padx=12, pady=(0, 12))

        controls = ctk.CTkFrame(shell, fg_color="transparent")
        controls.grid(row=2, column=0, sticky="ew", padx=18, pady=(0, 18))
        controls.grid_columnconfigure(0, weight=1)
        self._make_primary_button(controls, "OK", dialog.destroy).grid(row=0, column=0, sticky="ew")

        dialog.update_idletasks()
        parent_x = self.winfo_x()
        parent_y = self.winfo_y()
        parent_width = self.winfo_width()
        parent_height = self.winfo_height()
        dialog_width = dialog.winfo_width()
        dialog_height = dialog.winfo_height()
        dialog.geometry(f"+{parent_x + max((parent_width - dialog_width) // 2, 0)}+{parent_y + max((parent_height - dialog_height) // 2, 0)}")
        self.wait_window(dialog)

    def _show_copy_preview(self) -> bool:
        dialog = ctk.CTkToplevel(self)
        dialog.title("Zielvorschau")
        dialog.geometry("980x620")
        dialog.transient(self)
        dialog.grab_set()
        dialog.grid_columnconfigure(0, weight=1)
        dialog.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(dialog, text="Zielvorschau vor dem Start", font=self._font(20, "bold")).grid(row=0, column=0, sticky="w", padx=20, pady=(18, 10))
        preview = ctk.CTkScrollableFrame(dialog, fg_color="transparent")
        preview.grid(row=1, column=0, sticky="nsew", padx=20, pady=(0, 12))
        preview.grid_columnconfigure(0, weight=1)
        for idx, job in enumerate(self.jobs):
            row = ctk.CTkFrame(preview, corner_radius=14, border_width=1, fg_color=self.palette["card"], border_color=self.palette["border"])
            row.grid(row=idx, column=0, sticky="ew", pady=(0, 10))
            row.grid_columnconfigure(0, weight=1)
            ctk.CTkLabel(row, text=f"{job.media_type} · {Path(job.source).name}", font=self._font(11, "bold")).grid(row=0, column=0, sticky="w", padx=14, pady=(12, 4))
            ctk.CTkLabel(row, text=f"Quelle: {job.source}", font=self._font(10), justify="left", wraplength=880).grid(row=1, column=0, sticky="w", padx=14)
            ctk.CTkLabel(row, text=f"Ziel: {job.target}", font=self._font(10), justify="left", wraplength=880).grid(row=2, column=0, sticky="w", padx=14, pady=(4, 12))

        confirmed = {"value": False}
        controls = ctk.CTkFrame(dialog, fg_color="transparent")
        controls.grid(row=2, column=0, sticky="ew", padx=20, pady=(0, 20))
        controls.grid_columnconfigure(0, weight=1)
        controls.grid_columnconfigure(1, weight=1)

        def approve():
            confirmed["value"] = True
            dialog.destroy()

        self._make_secondary_button(controls, "Abbrechen", dialog.destroy).grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self._make_primary_button(controls, "Starten", approve).grid(row=0, column=1, sticky="ew", padx=(8, 0))
        self.wait_window(dialog)
        return confirmed["value"]

    def on_close(self):

        if self.running:
            if not messagebox.askyesno(APP_NAME, "Es läuft noch ein Kopiervorgang. Anwendung trotzdem schließen?"):
                return
        self.destroy()


def main():
    app = PlexTransferApp()
    app.mainloop()


if __name__ == "__main__":
    main()
