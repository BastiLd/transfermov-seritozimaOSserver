# Plex Transfer

Kleine lokale Windows-App für deinen Plex-/NAS-Kopierworkflow mit Python und CustomTkinter.

## Start

1. Prüfen, dass Python 3.11 oder neuer unter Windows installiert ist.
2. Sicherstellen, dass `robocopy` vorhanden ist. Unter Windows 10/11 ist das standardmäßig der Fall.
3. Abhängigkeiten installieren:

```powershell
pip install -r requirements.txt
```

4. App im Projektordner starten:

```powershell
python app.py
```

Alternativ per Doppelklick auf `start_plex_transfer.pyw`.

## Bedienung

- `Film auswählen`: einzelne Videodatei als Filmjob hinzufügen
- `Serie auswählen`: Ordner als Serienjob hinzufügen
- `Mehrere Dateien/Ordner auswählen`: mehrere Dateien und Ordner gesammelt hinzufügen
- Drag & Drop:
  - Datei auf das Fenster ziehen = Film
  - Ordner auf das Fenster ziehen = Serie
- `Kopiervorgang starten`: startet `robocopy` seriell oder mit maximal 2 parallelen Jobs
- `Logs öffnen`: öffnet den lokalen Log-Ordner
- `Plex Refresh`: löst manuell einen Plex-Library-Refresh aus
- Zahnrad oben rechts: öffnet die separate Einstellungsseite
- Kopien laufen mit schnellen LAN-Flags (`/J`, `/MT:8`, kurze Retry-Werte). Robocopys langsamer Restart-Modus `/Z` ist bewusst deaktiviert.

## Oberfläche

- Hauptseite für Aktionen, Drop-Zone, Jobliste, Status und Log
- Separate Einstellungsseite statt permanenter rechter Sidebar
- Einstellungen werden erst nach `Einstellungen speichern` übernommen
- Helles und dunkles Theme auswählbar
- Job-Verwaltung direkt in der Liste:
  - `Nach oben`
  - `Nach unten`
  - `Entfernen`
  - `Alle entfernen`
- Der rechte Statusbereich zeigt die gesamte offene Transfergröße und den freien Speicher des Ziel-Laufwerks vor und nach der Kopie.
- In den Einstellungen kann die offene Jobliste automatisch gespeichert und beim nächsten Start wiederhergestellt werden.

## Zielstruktur

- Filme:
  - `Z:\Movies\Filmname\Filmname.ext`
- Serien:
  - mit vorhandenen Staffelordnern: `Z:\Series\Serienname\...`
  - ohne Staffelordner: `Z:\Series\Serienname\Season 01\...`

## Dateien

- `app.py`: komplette Anwendung
- `requirements.txt`: benötigte GUI-Abhängigkeit
- `config.json`: wird beim ersten Start automatisch angelegt
- `logs\`: Laufzeit-Logs pro Kopiervorgang

## Hinweise

- Netzlaufwerke `Z:\Movies` und `Z:\Series` müssen erreichbar sein.
- Die angezeigte Dauer basiert auf echter Schreibgeschwindigkeit zum Zielpfad, nicht auf der theoretischen 1-Gbit-Linkrate. Nach Netzwerk- oder Flag-Änderungen `Geschwindigkeit testen` erneut ausführen.
- Robocopy-Rückgabecodes kleiner `8` werden als Erfolg behandelt.
- Die App bleibt eine reine lokale Windows-Desktop-App ohne Web- oder Electron-Komponenten.
