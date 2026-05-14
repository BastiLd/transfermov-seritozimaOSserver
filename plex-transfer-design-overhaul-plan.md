# Implementation Plan: Plex Transfer Design Overhaul

Dieser Plan ist für die Umsetzung durch Gemini 3.1 Pro konzipiert. Ziel ist eine signifikante Verbesserung der visuellen Qualität, des Layouts und der User Experience der Plex Transfer Electron App, ohne dabei die bestehende Funktionalität zu verändern.

## Referenzbilder
Die folgenden Bilder dienen als visuelle Grundlage für den aktuellen Zustand und die Problemzonen:
1. `01-dark-main-empty-and-queue.png`
2. `02-dark-modals-and-toast.png`
3. `03-settings-dark-and-light.png`
4. `04-light-main-contrast-issues.png`
5. `05-user-captures-problem-states.png`

**Wichtig:** Jede Collage enthält mehrere Teil-Screens. Alle Teil-Screens sind als separate Referenzzustände zu behandeln.

## „Nicht ändern“-Vorgaben (Constraints)
Um die Stabilität der App zu gewährleisten, dürfen folgende Bereiche **NICHT** verändert werden:
- **KEINE** Änderungen an der Business-Logik.
- **KEINE** Änderungen an der Robocopy-Logik oder den Transfer-Prozessen.
- **KEINE** Änderungen an der Plex-API-Integration oder dem Refresh-Logik.
- **KEINE** Änderungen an der Speicherung oder Struktur der `config.json`.
- **KEINE** neuen App-Features hinzufügen.
- **Fokus:** Ausschließlich Design, Icons, Layout, Animationen, Mascot und visuelle State-Klassen.

---

# Implementation Plan - Plex Transfer Design Overhaul

## Design-Diagnose
- **Light Theme Kontrast:** Massive Lesbarkeitsprobleme (weißer Text auf hellem Grund).
- **Header-Layout:** Überschriften werden teils abgeschnitten oder wirken bei kleinen Fenstern „gequetscht“.
- **Modals:** Zu simpel, fehlende visuelle Tiefe und unpassende Overlays.
- **Icon-Sprache:** Aktuell werden Text-Platzhalter (⚙, ＋) verwendet; ein konsistentes Icon-Set fehlt.
- **Polishing:** Abstände, Schatten und Trennungen wirken noch nicht final.

## Zielbild
- **Stimmung:** Technisch-robust, aber freundlich und hochwertig.
- **Ästhetik:** Verfeinerte Glassmorphism-Effekte, weiche Verläufe und flüssige Interaktionen.
- **Mascot:** Einführung von „Plexie“, einem animierten Begleiter, der den Status der App visualisiert.

## Konkrete Designänderungen

### 1. App Shell & Header
- Refinement der `.topbar` (Padding/Height), um Cropping zu verhindern.
- Modernisierung des Brand-Markings (Gradient/Glow).
- Ersatz von Text-Icons durch Lucide SVG Icons.

### 2. Main Action Area & Hero Panel
- Kontrastverbesserung im `.hero-panel`.
- Buttons: Hover-Glow, Active-Scaling und verfeinerte Gradients.
- Der „Start“-Button muss optisch als Hauptaktion hervorstechen.

### 3. Queue / Table / Drop-Zone
- **Drop-Zone:** Pulsierende Animation bei Drag-Over, besseres Border-Styling.
- **Tabelle:** Sticky-Header Styling, sauberes Path-Truncation (Middle-Ellipsis).
- **Status-Farben:** Eindeutigere Farben für Erfolg, Warnung und Fehler.

### 4. Right Status Rail & Metrics
- Karten-Layout mit besseren Spacing und inneren Schatten.
- Fortschrittsbalken: Shimmer-Effekt während aktiver Transfers.
- **Mascot-Platz:** Dedizierter Bereich für das Mascot (z. B. über dem Gesamtfortschritt).

### 5. Modals & Toasts
- **Modals:** Mehr Blur für den Hintergrund, Scale-In Animation, klare Header/Footer Trennung.
- **Toasts:** Slide-In Animationen und farblich codierte Icons für Statusmeldungen.

### 6. Light & Dark Themes
- **Light Theme:** Komplette Überarbeitung der Variablen für maximale Barrierefreiheit (AA-Kontrast).
- **Dark Theme:** Mehr Tiefe durch Texturen oder subtile Verläufe.

---

## Icon-Strategie
- **Bibliothek:** Lucide Icons (als Inline-SVG).
- **Einsatz:** Einstellungen, Film, Serie, Multi-Add, Start, Abbrechen, Logs, Refresh, Suche, Retry, Löschen, Up/Down.

## Mascot-Strategie: „Plexie“
- **Stil:** Kleiner, runder Roboter (NAS-Thematik) als SVG.
- **Technik:** CSS Keyframe Animations.
- **Zustände:**
  - **Idle:** Sanftes Schweben, langsames Blinken.
  - **Happy:** Kurzer Spin (bei Job-Hinzufügung).
  - **Busy:** Antenne dreht sich, vibriert leicht (während Transfer).
  - **Warning:** Besorgter Blick, oranges Blinken (bei Fehler).
  - **Sleeping:** Statisch, „Zzz“-Animation (wenn fertig).

---

## Implementation Checklist for Gemini 3.1 Pro

1. [ ] **Foundation:** CSS-Variablen in `styles.css` für beide Themes korrigieren (Fokus auf Light Theme Kontrast).
2. [ ] **Icons:** Alle Text-Platzhalter in `index.html` durch Lucide Inline-SVGs ersetzen.
3. [ ] **Components:** Hero-Panel und Buttons polieren (Gradients, Schatten, Hover-Effekte).
4. [ ] **Layout:** Responsivität des Headers und der Tabelle sicherstellen (kein Abschneiden mehr).
5. [ ] **Mascot:** Integration des SVG-Mascots in `index.html` und CSS-Animationen in `styles.css`.
6. [ ] **Renderer Hooks:** In `renderer.js` lediglich State-Klassen für das Mascot toggeln (z.B. `.mascot-busy`).
7. [ ] **Modals/Toasts:** Overlay-Styles und Einblend-Animationen finalisieren.
8. [ ] **QA:** Visueller Abgleich mit allen 5 Referenz-Collagen.
