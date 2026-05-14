# Plex Transfer Figma Blueprint

Source of truth used:
- UI code in `app.py`
- User screenshots from April 11 and April 16, 2026

Constraint:
- Max 2 pages in Figma
- Every app screen or dialog in its own frame

## Recommended Page Structure

### Page 1: App Screens

Frame 01 - `Desktop / Main / Empty`
- Size: 1380 x 900
- Dark theme
- Includes:
  - Header with app title, subtitle, settings icon, status badge
  - Actions card
  - Jobs card with empty table
  - Drop zone
  - Log card
  - Right status rail
- Reference: initial screenshots with no jobs

Frame 02 - `Desktop / Main / Queue Loaded`
- Size: 1380 x 900
- Same shell as Frame 01
- Jobs table populated with at least 1 item
- Status rail still idle
- Use to show normal pre-run state

Frame 03 - `Desktop / Main / Running`
- Size: 1380 x 900
- Same shell as Frame 01
- Job table with:
  - one active row
  - queued rows
  - mixed checkbox states
- Status rail with running badge and active progress
- Log panel with live robocopy lines
- Use screenshots showing 20%, 32%, 35%, 76%, partial completion as variants or duplicate examples

Frame 04 - `Desktop / Main / Finished`
- Size: 1380 x 900
- Same shell as Frame 01
- All rows copied
- Status rail shows `Fertig`
- Overall progress 100%
- Log contains robocopy completion output

Frame 05 - `Desktop / Settings`
- Size: 1380 x 900
- Same top shell as main window
- This is not a separate app window in code; it is a full-screen view swap inside the same desktop window
- Includes:
  - top title `Einstellungen`
  - save and back actions
  - cards for `Ziele`, `Plex`, `Parallelitaet`, `Darstellung`
  - text fields
  - checkbox
  - segmented controls

### Page 2: Dialogs and Native Windows

Frame 06 - `Dialog / Mehrere Medien hinzufuegen`
- Custom dialog
- Recommended size: auto-layout / hug, roughly 720 x 220
- Includes:
  - title
  - helper text
  - three buttons: `Dateien waehlen`, `Ordner waehlen`, `Schliessen`

Frame 07 - `Dialog / Zielvorschau`
- Custom dialog
- Size: 980 x 620
- Includes:
  - title
  - scrollable list of source / target pairs
  - footer actions `Abbrechen` and `Starten`

Frame 08 - `Dialog / Kopiervorgang abgeschlossen / Current Code`
- Custom dialog
- Size: 430 x 280
- Includes:
  - circular success or error badge
  - title
  - descriptive body copy
  - three metric cards: success, skipped, failed
  - single `OK` button

Frame 09 - `Dialog / Kopiervorgang abgeschlossen / Legacy Native`
- Use screenshot reference only
- Native Windows info box version
- Include if you want the historical state preserved in Figma
- If not needed, omit this frame and keep only Frame 08

Frame 10 - `Dialog / Windows File Picker`
- Generic native OS picker frame
- Use as reusable reference for:
  - Film auswaehlen
  - Mehrere Filme auswaehlen

Frame 11 - `Dialog / Windows Folder Picker`
- Generic native OS picker frame
- Use as reusable reference for:
  - Serie auswaehlen
  - Serienordner auswaehlen

Frame 12 - `Dialog / Native Messageboxes`
- One wide frame containing 4 compact dialog variants:
  - Confirm
  - Info
  - Error
  - Yes / No / Cancel
- Covers cases like:
  - clear all jobs
  - missing paths
  - speed test question
  - Plex refresh result
  - close while copy is running

## Best Fit For 2 Figma Pages

If you want the leanest usable file, keep these frames only:
- Page 1:
  - `Desktop / Main / Empty`
  - `Desktop / Main / Queue Loaded`
  - `Desktop / Main / Running`
  - `Desktop / Main / Finished`
  - `Desktop / Settings`
- Page 2:
  - `Dialog / Mehrere Medien hinzufuegen`
  - `Dialog / Zielvorschau`
  - `Dialog / Kopiervorgang abgeschlossen / Current Code`
  - `Dialog / Windows File Picker`
  - `Dialog / Windows Folder Picker`
  - `Dialog / Native Messageboxes`

## Components To Build First In Figma

Create these as reusable components before composing frames:
- `Top Bar`
- `Status Badge`
- `Primary Button`
- `Secondary Button`
- `Card Shell`
- `Metric Tile`
- `Drop Zone`
- `Job Table Header`
- `Job Table Row / Idle`
- `Job Table Row / Running`
- `Job Table Row / Success`
- `Job Table Row / Selected`
- `Progress Bar / Overall`
- `Progress Row / Active`
- `Log Panel`
- `Dialog Shell`
- `Native Messagebox`

## Tokens From Current Code

Dark theme:
- bg: `#171b22`
- card: `#202833`
- card_soft: `#252f3b`
- border: `#303b48`
- text: `#f1f4f8`
- muted: `#a6b2c1`
- primary: `#3478f6`
- primary_hover: `#2a69de`
- primary_soft: `#1d2f52`
- success: `#5dc07a`
- warning: `#d9a24e`
- danger: `#e06a78`
- table_header: `#283240`
- table_selected: `#2a3d60`

Light theme also exists in code, but current config and screenshots are dark-first.

## Important Notes

- The settings area is a separate screen state, not a separate desktop window.
- The file/folder pickers and most simple alerts are native Windows dialogs, so in Figma they should be treated as reference windows, not app-styled custom modals.
- There is one mismatch between screenshots and current code:
  - screenshots show a native completion info box
  - current code defines a custom dark completion dialog
- If current code is the target, use Frame 08 as the primary completion dialog.

