# Plan: zweites Minimal-Device, VISION-Update, schnellere Build-Umgebung

## Context
- Der Flicker-Stand ist gut: PWM `frequency: 300Hz` (bereits geflasht, in `obegraensad-clock.yaml`). Falsche Pixel kommen von PWM-Flanken (1 kHz und 5 kHz waren schlechter), nicht von Software-Jitter. Das bleibt unangetastet ("don't ruin it").
- Gewünscht: ein zweites, minimales Device-Config, das nur die Uhrzeit zeigt, plus Doku-Update und eine auf 8 Kerne optimierte ESPHome-Umgebung. Jede Teilaufgabe läuft in einem eigenen Opus-Agent (medium effort).
- Nicht anfassen: `obegraensad-clock.yaml`, `images.h`, `components/` (Treiber), `secrets.yaml`. Nicht flashen, nicht committen.

## Teilaufgaben

### 1. `obegraensad-simple.yaml` (Agent A, zuerst)
- Node `obegraensad-simple`, friendly_name "IKEA OBEGRÄNSAD Simple". Lokale Komponente `components/obegraensad_panel`, gleiche Pins wie das Haupt-Config (latch 12, clock 4, data 5, Button 13, PWM 14 inverted, `esp8266_pwm`, `frequency: 300Hz` mit Kommentar).
- Nur Uhr: `time` (Europe/Berlin) plus Display-Lambda mit Schrift `04B03.ttf`, 1:1 aus dem bestehenden Config. Kein http_request, kein Worker, keine Bilder, kein `images.h`, keine Sonnenstand-Automatik.
- Dimmen: Taster GPIO13 schaltet zyklisch in Stufen (inkl. aus). Im WebUI (`web_server` v3) gibt es Dimm-Slider, An/Aus-Schalter und einen "Dimmstufe weiter"-Button.
- Entscheidung Kalibrierung: behalten (`min_power` 17/255), Slider zeigt PWM-Level − 16 (16 → 0 = aus, 17 → 1, …, Bereich 0..239), umgesetzt über ein einfaches `number`-Template. Wenn es nicht schlank geht, wird es weggelassen und begründet.
- Entscheidung Clock-Code: im YAML (Display-Lambda) lassen, solange es nur wenige Zeilen sind. Keine neue Komponente.
- Prüfung: `.env/bin/esphome config` und `compile` mit `obegraensad-simple.yaml`.

### 2. Build-Umgebung für 8 Kerne (Agent C, parallel zu 1)
- Anhand des installierten esphome-/PlatformIO-Codes verifizieren, wie parallelisiert wird (SCons `-j`, Env-Variablen, `platformio_options`), ob ccache verfügbar ist und ob Cache- oder Update-Checks bremsen.
- Umsetzung bevorzugt außerhalb des YAML (z. B. kleines `build.sh` oder Env-Variablen). Keine Systemänderungen. Messung vorher/nachher an `obegraensad-clock.yaml` (Unsicherheit nennen, da Agent A parallel kompiliert).

### 3. `VISION.md` aktualisieren (Agent B, nach 1)
- Zweites Device und seine Rolle dokumentieren. Zusätzlich die Erkenntnisse zum Flackern festhalten: 300 Hz ist am besten, ein Rest-Flackern bei Teilhelligkeit bleibt, mögliche Hardware-Abhilfe sind Kondensator oder Serienwiderstand an Clock/Latch.
- Außerdem die Architekturskizze auf den tatsächlichen Stand bringen (lokale Komponente, 2 Configs).
- Falls nötig, Verweis in `CLAUDE.md` (Layout) ergänzen.

## Reihenfolge und Abhängigkeiten
1 und 2 laufen parallel (getrennte Build-Verzeichnisse pro Node). 3 startet, wenn 1 fertig ist, damit die Doku dessen Entscheidungen widerspiegelt.

## Verifikation
- `esphome config` und `esphome compile` für beide YAMLs, RAM/Flash vergleichen.
- Build-Zeiten vorher/nachher aus Agent C.
- `git status`/`git diff`: nur die erwarteten Dateien geändert (`obegraensad-simple.yaml`, `VISION.md`, evtl. `CLAUDE.md`, Build-Script).
- Ein Flash von `obegraensad-simple.yaml` auf echte Hardware erfolgt nur nach Rückfrage.
