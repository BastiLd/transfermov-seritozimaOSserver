# Plex Transfer Electron

Eigenständige Electron-Version der lokalen Plex-Transfer-App. Diese Version ist die Haupt-App im Repository.

## Entwicklung

```powershell
npm install
npm start
```

## Portable EXE bauen

```powershell
npm run dist
```

Die portable EXE liegt danach unter:

```text
dist\Plex Transfer Portable.exe
```

## Laufzeitdaten

- Im Entwicklungsmodus nutzt die App `config.json` und `logs\` direkt im `App`-Ordner.
- Wenn keine lokale `config.json` existiert, wird sie aus `default-config.json` erzeugt.
- Die portable EXE legt `config.json` und `logs\` neben der EXE an bzw. nutzt sie dort.
- Die Python-App im übergeordneten Ordner bleibt als Legacy-Version erhalten, wird für Electron aber nicht benötigt.
