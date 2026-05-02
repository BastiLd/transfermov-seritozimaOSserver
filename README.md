# Plex Transfer

Lokale Windows-Desktop-App für den Plex-/NAS-Kopierworkflow mit Electron und Robocopy.

## Haupt-App starten

```powershell
cd App
npm install
npm start
```

## Portable EXE bauen

```powershell
cd App
npm run dist
```

Die portable EXE liegt danach unter `App\dist\Plex Transfer Portable.exe`.

## Bedienung

- `Film auswählen`: einzelne Videodateien als Filmjobs hinzufügen
- `Serie auswählen`: Serienordner oder Episodendateien hinzufügen
- `Mehrere Dateien/Ordner`: Dateien und Ordner gesammelt hinzufügen
- Drag & Drop auf die Drop-Zone fügt Medien direkt hinzu
- `Kopiervorgang starten`: zeigt eine Zielvorschau und startet Robocopy
- `Abbrechen`: beendet laufende Robocopy-Prozesse
- `Plex Refresh`: löst manuell einen Plex-Library-Refresh aus
- `Logs öffnen`: öffnet den lokalen Log-Ordner
- Rechtsklick auf Jobs: Quelle/Ziel öffnen, Pfad kopieren, verschieben oder entfernen

## Features

- Moderne Electron-Oberfläche mit Dark-/Light-Theme
- Warteschlange mit Suche, Drag & Drop, Duplikatwarnung und Retry für fehlgeschlagene Jobs
- Ziel-Speicheranzeige mit freiem Speicher vor und nach der geplanten Kopie
- Live-Status, Gesamtfortschritt, ETA und Geschwindigkeitstest
- Serielle Kopien oder Parallelmodus mit maximal 2 Jobs
- Automatischer Plex-Refresh nach erfolgreichem Kopieren, wenn konfiguriert
- Offene Jobs können gespeichert und beim nächsten Start wiederhergestellt werden

## Zielstruktur

- Filme: `Z:\Movies\Filmname.ext`
- Serienordner mit Staffelordnern: `Z:\Series\Serienname\...`
- Serienordner ohne Staffelordner: `Z:\Series\Serienname\Season 01\...`
- Einzelne Episoden: `Z:\Series\Serienname\Season 01\Episode.ext`

## Dateien

- `App\main.js`: Electron-Main-Prozess, Robocopy, Plex Refresh, Config und System-APIs
- `App\src\renderer.js`: UI-Logik
- `App\src\styles.css`: Design
- `App\config.json`: lokale Laufzeitkonfiguration
- `app.py`: alte Python-/CustomTkinter-Version als Legacy-App

## Hinweise

- Windows mit Robocopy wird vorausgesetzt.
- Die Zielpfade müssen erreichbar sein, bevor echte Kopien gestartet werden.
- Robocopy läuft mit schnellen LAN-Flags (`/J`, seriell `/MT:32`, parallel `/MT:8`, kurze Retry-Werte). Vorhandene Dateien werden nicht ersetzt (`/XC`, `/XN`, `/XO`).
