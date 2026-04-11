# -*- coding: utf-8 -*-
import ctypes
import json
import os
import queue
import re
import subprocess
import threading
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
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or "Unbekannt"


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

        self.status_var = tk.StringVar(value="Bereit")
        self.status_detail_var = tk.StringVar(value="Wartet auf neue Jobs.")
        self.summary_var = tk.StringVar(value="Noch keine Kopiervorgänge gestartet.")
        self.last_action_var = tk.StringVar(value="Keine letzte Aktion.")
        self.job_meta_var = tk.StringVar(value="0 Jobs in der Liste")

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
        self._make_secondary_button(action_row, "Logs öffnen", self.open_logs).grid(row=0, column=1, sticky="ew", padx=4)
        self._make_secondary_button(action_row, "Plex Refresh", self.manual_refresh).grid(row=0, column=2, sticky="ew", padx=(8, 0))

        self.jobs_card, jobs_body = self._create_card(left, "Jobs", "Quelle, Ziel, Typ, Status und Fortschritt im Überblick")
        self.jobs_card.grid(row=1, column=0, sticky="nsew", pady=(0, 14))
        jobs_body.grid_rowconfigure(3, weight=1)
        ctk.CTkLabel(jobs_body, textvariable=self.job_meta_var, font=self._font(10)).grid(row=0, column=0, sticky="w", pady=(0, 10))

        self.drop_zone = ctk.CTkFrame(jobs_body, corner_radius=14, border_width=1)
        self.drop_zone.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        self.drop_zone.grid_columnconfigure(0, weight=1)
        self.drop_title = ctk.CTkLabel(self.drop_zone, text="Drop-Zone", font=self._font(12, "bold"))
        self.drop_title.grid(row=0, column=0, sticky="w", padx=14, pady=(12, 2))
        self.drop_text = ctk.CTkLabel(self.drop_zone, text="Datei hierher ziehen = Film\nOrdner hierher ziehen = Serie", font=self._font(10), justify="left")
        self.drop_text.grid(row=1, column=0, sticky="w", padx=14, pady=(0, 12))

        manage_row = ctk.CTkFrame(jobs_body, fg_color="transparent")
        manage_row.grid(row=2, column=0, sticky="ew", pady=(0, 12))
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
        table_shell.grid(row=3, column=0, sticky="nsew")
        table_shell.grid_rowconfigure(0, weight=1)
        table_shell.grid_columnconfigure(0, weight=1)
        self.job_tree = ttk.Treeview(table_shell, columns=("source", "target", "type", "status", "progress"), show="headings", selectmode="browse", style="Plex.Treeview")
        for name, heading, width, anchor, stretch in (
            ("source", "Quelle", 270, "w", True),
            ("target", "Ziel", 290, "w", True),
            ("type", "Typ", 90, "center", False),
            ("status", "Status", 120, "center", False),
            ("progress", "Fortschritt", 110, "center", False),
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
        self.job_tree.bind("<Button-3>", self.open_tree_context_menu)
        self.jobs_empty_state = ctk.CTkLabel(table_shell, text="Noch keine Jobs.\nFüge einen Film oder Serienordner hinzu oder nutze die Drop-Zone.", font=self._font(11), justify="center")
        self.jobs_empty_state.place(relx=0.5, rely=0.5, anchor="center")

        self.log_card, log_body = self._create_card(left, "Laufendes Log", "Robocopy-Ausgabe und Systemmeldungen")
        self.log_card.grid(row=2, column=0, sticky="nsew")
        log_body.grid_rowconfigure(0, weight=1)
        log_font = "Cascadia Mono" if "Cascadia Mono" in set(tkfont.families(self)) else "Consolas"
        self.log_box = ctk.CTkTextbox(log_body, border_width=1, corner_radius=14, font=(log_font, 10), wrap="word")
        self.log_box.grid(row=0, column=0, sticky="nsew")
        self.log_box.configure(state="disabled")

        self.status_card, status_body = self._create_card(right, "Status", "Gesamtstatus, Fortschritt und letzte Aktion")
        self.status_card.grid(row=0, column=0, sticky="new")
        ctk.CTkLabel(status_body, textvariable=self.status_detail_var, font=self._font(12, "bold"), justify="left").grid(row=0, column=0, sticky="w", pady=(0, 12))
        self.overall_progress = ctk.CTkProgressBar(status_body, height=14, corner_radius=999)
        self.overall_progress.grid(row=1, column=0, sticky="ew")
        self.overall_progress.set(0)
        ctk.CTkLabel(status_body, textvariable=self.summary_var, font=self._font(10), justify="left", wraplength=320).grid(row=2, column=0, sticky="w", pady=(10, 12))
        metrics = ctk.CTkFrame(status_body, fg_color="transparent")
        metrics.grid(row=3, column=0, sticky="ew", pady=(0, 12))
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

    def _apply_widget_palette(self):
        p = self.palette
        self.settings_button.configure(fg_color=p["card_soft"], hover_color=p["primary_soft"], text_color=p["text"], border_color=p["border"], border_width=1)
        self.title_label.configure(text_color=p["text"])
        self.subtitle_label.configure(text_color=p["muted"])
        self.header.configure(fg_color="transparent")
        self.content.configure(fg_color="transparent")
        self.main_view.configure(fg_color="transparent")
        self.main_left_scroll.configure(
            fg_color="transparent",
            scrollbar_button_color=p["scroll"],
            scrollbar_button_hover_color=p["scroll_hover"],
        )
        self.settings_view.configure(fg_color="transparent", scrollbar_button_color=p["scroll"], scrollbar_button_hover_color=p["scroll_hover"])

        for card in (self.actions_card, self.jobs_card, self.log_card, self.status_card):
            card.configure(fg_color=p["card"], border_color=p["border"])
        self.drop_zone.configure(fg_color=p["drop"], border_color=p["border"])
        self.drop_title.configure(text_color=p["text"])
        self.drop_text.configure(text_color=p["muted"])
        self.log_box.configure(fg_color=p["log_bg"], text_color=p["log_fg"], border_color="#1e2937", scrollbar_button_color=p["scroll"], scrollbar_button_hover_color=p["scroll_hover"])
        self.overall_progress.configure(fg_color=p["primary_soft"], progress_color=p["primary"])
        self.jobs_empty_state.configure(text_color=p["muted"])

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
        self.config_data = {
            "movies_root": self.settings_vars["movies_root"].get().strip(),
            "series_root": self.settings_vars["series_root"].get().strip(),
            "plex_url": self.settings_vars["plex_url"].get().strip(),
            "plex_token": self.settings_vars["plex_token"].get().strip(),
            "movies_section_id": self.settings_vars["movies_section_id"].get().strip(),
            "series_section_id": self.settings_vars["series_section_id"].get().strip(),
            "parallel_enabled": bool(self.settings_vars["parallel_enabled"].get()),
            "auto_refresh": bool(self.settings_vars["auto_refresh"].get()),
            "theme_mode": self.settings_vars["theme_mode"].get(),
        }
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

    def append_log(self, message: str, save_to_file: bool = False):
        timestamped = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
        self.log_box.configure(state="normal")
        self.log_box.insert("end", timestamped + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")
        if save_to_file and self.current_log_path:
            ensure_directory(LOG_DIR)
            with self.current_log_path.open("a", encoding="utf-8", errors="replace") as handle:
                handle.write(timestamped + "\n")

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
            if path.is_file() and looks_like_video(path):
                media_type = "Film"
            elif path.is_dir():
                media_type = "Serie"
            else:
                raise ValueError(f"Nicht unterstützter Pfad:\n{path}")

        if media_type == "Film":
            if not path.is_file():
                raise ValueError(f"Ein Film muss eine Videodatei sein:\n{path}")
            title = sanitize_name(path.stem)
            target_dir = Path(self.config_data["movies_root"]).expanduser() / title
            target_path = target_dir / f"{title}{path.suffix.lower()}"
        else:
            if not path.is_dir():
                raise ValueError(f"Eine Serie muss ein Ordner sein:\n{path}")
            show_name = sanitize_name(path.name)
            if has_season_subfolders(path):
                target_path = Path(self.config_data["series_root"]).expanduser() / show_name
            else:
                target_path = Path(self.config_data["series_root"]).expanduser() / show_name / "Season 01"
        job = Job(source=str(path), target=str(target_path), media_type=media_type, id=self.job_counter)
        self.job_counter += 1
        return job

    def on_tree_select(self, _event=None):
        selection = self.job_tree.selection()
        self.selected_job_id = int(selection[0]) if selection else None
        self._refresh_job_actions()

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

    def _refresh_job_actions(self):
        disabled = self.running or self.selected_job_id is None
        for button in (self.move_up_button, self.move_down_button, self.remove_button):
            button.configure(state="disabled" if disabled else "normal")
        self.clear_button.configure(state="disabled" if self.running or not self.jobs else "normal")
        if self.context_menu:
            end_index = self.context_menu.index("end")
            if end_index is not None:
                for index in range(end_index + 1):
                    item_type = self.context_menu.type(index)
                    if item_type == "separator":
                        continue
                    if index == end_index:
                        state = "disabled" if (self.running or not self.jobs) else "normal"
                    else:
                        state = "disabled" if disabled else "normal"
                    self.context_menu.entryconfigure(index, state=state)

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
        idx = self._job_index(self.selected_job_id)
        if idx is None or self.running:
            return
        removed = self.jobs.pop(idx)
        self.selected_job_id = self.jobs[min(idx, len(self.jobs) - 1)].id if self.jobs else None
        self._refresh_job_list(preserve_selection=True)
        self._refresh_empty_state()
        self.last_action_var.set(f"Job entfernt: {Path(removed.source).name}")

    def clear_all_jobs(self):
        if self.running or not self.jobs:
            return
        if not messagebox.askyesno(APP_NAME, "Alle Jobs wirklich entfernen?"):
            return
        self.jobs.clear()
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
            color_key = "danger" if job.status.startswith("Fehler") else JOB_COLORS.get(job.status, "muted")
            self.job_tree.tag_configure(tag, foreground=self.palette[color_key])
            self.job_tree.insert("", "end", iid=str(job.id), values=(job.source, job.target, job.media_type, job.status, job.progress), tags=(tag,))
        if selected and str(selected) in self.job_tree.get_children():
            self.job_tree.selection_set(str(selected))
        else:
            self.selected_job_id = int(self.job_tree.get_children()[0]) if self.job_tree.get_children() else None
            if self.selected_job_id is not None:
                self.job_tree.selection_set(str(self.selected_job_id))
        total = len(self.jobs)
        success = sum(1 for job in self.jobs if job.status == "Kopiert")
        skipped = sum(1 for job in self.jobs if job.status == "Übersprungen")
        failed = sum(1 for job in self.jobs if job.status.startswith("Fehler"))
        completed = success + skipped + failed
        self.job_meta_var.set(f"{total} Jobs in der Liste")
        if total == 0:
            self.overall_progress.set(0)
            self.summary_var.set("Noch keine Kopiervorgänge gestartet.")
        else:
            self.overall_progress.set(completed / total)
            self.summary_var.set(f"Erfolgreich {success} | Übersprungen {skipped} | Fehlgeschlagen {failed}")
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

    def start_copy(self):
        if self.running:
            messagebox.showinfo(APP_NAME, "Es läuft bereits ein Kopiervorgang.")
            return
        if not self.jobs:
            messagebox.showinfo(APP_NAME, "Es sind keine Jobs vorhanden.")
            return
        if not self.validate_roots():
            return

        self.running = True
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
        self.ui_queue.put(("job_update", (job.id, "Kopiert...", "0%")))
        self.ui_queue.put(("log", f"Starte Job #{job.id}: {job.source} -> {job.target}"))
        try:
            ensure_directory(target_path.parent if job.media_type == "Film" else target_path)
            command = self._build_robocopy_command(job)
            self.ui_queue.put(("log", f"robocopy {' '.join(command)}"))
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            last_progress = "0%"
            if process.stdout:
                for line in process.stdout:
                    cleaned = line.rstrip()
                    if cleaned:
                        self.ui_queue.put(("log", f"Job #{job.id}: {cleaned}"))
                    progress = self._extract_progress(cleaned)
                    if progress and progress != last_progress:
                        last_progress = progress
                        self.ui_queue.put(("job_update", (job.id, "Kopiert...", progress)))
            return_code = process.wait()
            job.return_code = return_code
            if return_code < 8:
                if return_code == 0:
                    self.ui_queue.put(("job_update", (job.id, "Übersprungen", last_progress)))
                    self.ui_queue.put(("log", f"Job #{job.id} ohne Änderungen beendet (Code 0)."))
                else:
                    self.ui_queue.put(("job_update", (job.id, "Kopiert", "100%")))
                    self.ui_queue.put(("log", f"Job #{job.id} erfolgreich abgeschlossen (Code {return_code})."))
            else:
                self.ui_queue.put(("job_update", (job.id, f"Fehler ({return_code})", last_progress)))
                self.ui_queue.put(("log", f"Job #{job.id} fehlgeschlagen (Code {return_code})."))
        except Exception as exc:
            self.ui_queue.put(("job_update", (job.id, "Fehler", "-")))
            self.ui_queue.put(("log", f"Job #{job.id} abgebrochen: {exc}"))

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
            messagebox.showinfo(APP_NAME, "Bitte zuerst Plex-URL und Token in den Einstellungen speichern.")
            return
        movies_ok, series_ok = self._trigger_plex_refresh()
        if movies_ok or series_ok:
            self.append_log("Plex-Refresh erfolgreich ausgelöst.", save_to_file=True)
            self.last_action_var.set("Plex-Refresh ausgelöst.")
            self._set_global_status("Bereit", "Plex-Refresh gesendet.")
            messagebox.showinfo(APP_NAME, "Plex-Refresh wurde ausgelöst.")
        else:
            self.append_log("Plex-Refresh konnte nicht ausgelöst werden.", save_to_file=True)
            self.last_action_var.set("Plex-Refresh fehlgeschlagen.")
            self._set_global_status("Fehler", "Plex-Refresh fehlgeschlagen.")
            messagebox.showerror(APP_NAME, "Plex-Refresh konnte nicht ausgelöst werden.")

    def _trigger_plex_refresh(self) -> tuple[bool, bool]:
        base_url = str(self.config_data.get("plex_url", "")).rstrip("/")
        token = str(self.config_data.get("plex_token", "")).strip()
        movies_section = str(self.config_data.get("movies_section_id", "")).strip()
        series_section = str(self.config_data.get("series_section_id", "")).strip()
        if not base_url or not token:
            return False, False

        def refresh(section_id: str) -> bool:
            if not section_id:
                return False
            url = f"{base_url}/library/sections/{section_id}/refresh?X-Plex-Token={urllib.parse.quote(token)}"
            try:
                request = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(request, timeout=10) as response:
                    return 200 <= response.status < 300
            except Exception as exc:
                self.append_log(f"Plex-Refresh für Section {section_id} fehlgeschlagen: {exc}", save_to_file=True)
                return False

        movies_ok = refresh(movies_section)
        series_ok = refresh(series_section)
        return movies_ok, series_ok

    def _poll_ui_queue(self):
        try:
            while True:
                message_type, payload = self.ui_queue.get_nowait()
                if message_type == "log":
                    self.append_log(str(payload), save_to_file=True)
                elif message_type == "job_update":
                    job_id, status, progress = payload
                    for job in self.jobs:
                        if job.id == job_id:
                            job.status = status
                            job.progress = progress
                            break
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
        self._refresh_job_list(preserve_selection=True)
        if self.config_data.get("auto_refresh") and success:
            movies_ok, series_ok = self._trigger_plex_refresh()
            if movies_ok or series_ok:
                self.append_log("Automatischer Plex-Refresh erfolgreich ausgelöst.", save_to_file=True)
            else:
                self.append_log("Automatischer Plex-Refresh konnte nicht ausgelöst werden.", save_to_file=True)

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
