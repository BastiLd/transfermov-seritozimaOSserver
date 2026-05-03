# Plex Transfer

Lokale Windows-Desktop-App fuer den Plex-/NAS-Kopierworkflow mit Electron und Robocopy.

## Haupt-App starten

```powershell
npm --prefix App install
npm start
```

Alternativ kann die App weiterhin direkt aus dem Unterordner gestartet werden:

```powershell
cd App
npm start
```

## Portable EXE bauen

```powershell
npm run dist
```

Die portable EXE liegt danach unter `App\dist\Plex Transfer Portable.exe`.

## Bedienung

- `Film auswaehlen`: einzelne Videodateien als Filmjobs hinzufuegen
- `Serie auswaehlen`: Serienordner oder Episodendateien hinzufuegen
- `Mehrere Dateien/Ordner`: Dateien und Ordner gesammelt hinzufuegen
- Drag & Drop auf die Drop-Zone fuegt Medien direkt hinzu
- Beim Start wird zuerst der Workflow gewaehlt: Uebertragen, Umbenennen oder Beides
- `Kopiervorgang starten`: zeigt eine Zielvorschau und startet Robocopy
- `Umbenennen`: zeigt zuerst eine Plex-Namensvorschau und benennt erst nach Bestaetigung um
- `Beides`: benennt zuerst lokal um und uebertraegt danach auf das Plex-Ziel
- `Abbrechen`: beendet laufende Robocopy-Prozesse
- `Plex Refresh`: loest manuell einen Plex-Library-Refresh aus
- `Logs oeffnen`: oeffnet den lokalen Log-Ordner
- Rechtsklick auf Jobs: Quelle/Ziel oeffnen, Pfad kopieren, verschieben oder entfernen

## Features

- Moderne Electron-Oberflaeche mit Dark-/Light-Theme
- Warteschlange mit Suche, Drag & Drop, Duplikatwarnung und Retry fuer fehlgeschlagene Jobs
- Ziel-Speicheranzeige mit freiem Speicher vor und nach der geplanten Kopie
- Live-Status, Gesamtfortschritt, ETA und Geschwindigkeitstest
- Serielle Kopien oder Parallelmodus mit maximal 2 Jobs
- Automatischer Plex-Refresh nach erfolgreichem Kopieren, wenn konfiguriert
- Separater Plex-Refresh nach Transfer, Umbenennen oder Kombi-Workflow
- Offene Jobs koennen gespeichert und beim naechsten Start wiederhergestellt werden

## Zielstruktur

- Filme: `Z:\Movies\Filmname.ext`
- Serienordner mit Staffelordnern: `Z:\Series\Serienname\...`
- Serienordner ohne Staffelordner: `Z:\Series\Serienname\Season 01\...`
- Einzelne Episoden: `Z:\Series\Serienname\Season 01\Serienname - S01E01 - Titel.ext`
- Umbenannte Filme mit Plex-Struktur: `Z:\Movies\Filmname (Jahr)\Filmname (Jahr).ext`

## Dateien

- `App\main.js`: Electron-Main-Prozess, Robocopy, Plex Refresh, Config und System-APIs
- `App\src\renderer.js`: UI-Logik
- `App\src\styles.css`: Design
- `App\config.json`: lokale Laufzeitkonfiguration
- `app.py`: alte Python-/CustomTkinter-Version als Legacy-App

## Hinweise

- Windows mit Robocopy wird vorausgesetzt.
- Die Zielpfade muessen erreichbar sein, bevor echte Kopien gestartet werden.
- Robocopy laeuft mit schnellen LAN-Flags (`/J`, seriell `/MT:32`, parallel `/MT:8`, kurze Retry-Werte). Vorhandene Dateien werden nicht ersetzt (`/XC`, `/XN`, `/XO`).
- Die Default-Config fuer neue portable Builds enthaelt die aktuell gewaehlten Plex-Daten inklusive Token.
