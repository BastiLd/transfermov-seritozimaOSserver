# Plex Transfer Electron

Eigenständige Electron-Version der lokalen Plex-Transfer-App. Diese Version ist die Haupt-App im Repository.

## Entwicklung

```powershell
npm install
npm start
```

## Windows-Installer bauen

```powershell
npm run dist
```

Der NSIS-Installer liegt danach unter:

```text
dist\Plex Transfer Setup 1.0.0.exe
```

Wenn zusaetzlich eine portable EXE benoetigt wird:

```powershell
npm run dist:portable
```

## Laufzeitdaten

- Im Entwicklungsmodus nutzt die App `config.json` und `logs\` direkt im `App`-Ordner.
- Wenn keine lokale `config.json` existiert, wird sie aus `default-config.json` erzeugt.
- Der Installer-Build legt `config.json` und `logs\` im Benutzerdatenordner der installierten App ab.
- Die portable EXE legt `config.json` und `logs\` neben der EXE an bzw. nutzt sie dort.
- Die Python-App im übergeordneten Ordner bleibt als Legacy-Version erhalten, wird für Electron aber nicht benötigt.
