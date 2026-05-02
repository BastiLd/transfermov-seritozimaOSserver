# Plex Transfer Electron

Eigenstaendige Electron-Version der lokalen Plex-Transfer-App.

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

- Im Entwicklungsmodus nutzt die App eine lokale `config.json` und `logs\` direkt im `App`-Ordner.
- Wenn keine lokale `config.json` existiert, wird sie aus `default-config.json` erzeugt.
- Die portable EXE legt `config.json` und `logs\` neben der EXE an bzw. nutzt sie dort.
- Die bestehende Python-App im uebergeordneten Ordner wird nicht benoetigt.
