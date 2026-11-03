# CLAUDE.md

ESPHome firmware for an IKEA Obegränsad 16×16 LED panel on a Wemos D1 Mini (ESP8266). Product vision and roadmap: `VISION.md`. User-facing docs: `README.md`.

## Layout (flat; the repo root is the ESPHome config dir)

- `obegraensad-clock.yaml`: the main device config (node `obegraensad-clock`, IP 192.168.1.100)
- `obegraensad-simple.yaml`: minimal second device (node `obegraensad-simple`), clock only, no Worker/images; same pins and PWM settings
- `images.h`: bitmaps + animations (`draw_image`, `draw_matrix`, `draw_tetris`, `draw_snake`), pulled in via `esphome: includes:`
- `components/obegraensad_panel/`: the display driver (`display.py`, `obegraensad_panel.{h,cpp}`)
- `secrets.yaml` (gitignored; template in `secrets.yaml.example`), `.esphome/` (build cache), `.device-builder*` (Device Builder state, gitignored)
- `.env/`: Python venv with `esphome` and `esphome-device-builder`

The YAML loads the component from the local path (`external_components: source: {type: local, path: components}`), so driver edits need no push. Don't reintroduce a `github://` source for this device.

## Commands

```bash
.env/bin/esphome config  obegraensad-clock.yaml   # validate
.env/bin/esphome compile obegraensad-clock.yaml   # build (~1 min cold)
.env/bin/esphome run     obegraensad-clock.yaml   # build + OTA flash (touches the real device: ask first)
```

The Device Builder runs as the user systemd unit `esphome.service` (`systemctl --user ...`), pointed at the repo root. Its version history is disabled in `.device-builder-preferences.json` on purpose; otherwise it would commit into this repo.

## Driver invariants

- The LED mapping (`LOOKUP_TOP`/`LOOKUP_BOTTOM` + `led_index()`) and the shift-out order must stay bit-exact: LED `i` lives at `frame_[i % 16]`, bit `i / 16`; words go out in order, LSB first, then a latch pulse. Getting this wrong scrambles the image.
- The Nov 2026 rewrite was checked by a throwaway host test that recorded every pin write of the old Adafruit-based driver and the new one. For further driver changes, rebuild such a test against `git show e3eecef^:components/obegraensad_panel/obegraensad-driver.cpp` (stub `Arduino.h`/`Adafruit_GFX.h` and the ESPHome headers), and check that it fails on a deliberate bug.
- The shift-out uses `ISRInternalGPIOPin` (direct register writes). `InternalGPIOPin::digital_write` on the ESP8266 goes through Arduino `digitalWrite` (with waveform/PWM checks), so keep it out of the hot loop. Keep the 1 µs clock/latch pulses unless tested on hardware.
- Frames are sent on every update (100 ms) on purpose, so a glitched frame is fixed right away. Don't add "skip unchanged frames" without a periodic resend.
- No `lib_deps`. Adafruit GFX/BusIO/Wire/SPI were removed; ESPAsyncTCP comes in via `web_server`.

## Hardware / ESP8266 constraints

- Pins: latch GPIO12, clock GPIO4, data GPIO5, button GPIO13 (input, pullup, inverted), brightness PWM GPIO14 (inverted, `esp8266_pwm`).
- Hardware SPI on the ESP8266 only works with clock GPIO14 and data GPIO13, and `SPI.begin()` also claims GPIO12. Switching to SPI means rewiring (latch → e.g. GPIO15, button/PWM → GPIO4/5). ESPHome software SPI is slower than the current direct writes. On an ESP32 any pins work.
- Never start an `http_request` inside another request's `on_response` (caused a watchdog crash). Keep requests sequential: two TLS sessions don't fit in the heap. `verify_ssl: false` is deliberate (no cert pinning for `*.workers.dev`).
- Image 11 (all white) is disabled: WiFi dropped while it was shown, probably from LED current draw (unverified).

## Remote image source

Cloudflare Worker `https://clock-server.mikezter.workers.dev`: `GET /state` → image index (polled every 5 s; 0 = clock, 1..`max_img` = image), `GET /custom` → 16 newline-separated `uint16_t` rows for image 12 (MSB = leftmost pixel), `POST /reset` → clear when dismissed on the panel. The Worker code is not in this repo (`~/obegransand/clock-server`); its state lives in a SQLite Durable Object `Panel` (strongly consistent, works on Workers Free), not KV.

## Git

- `origin` = `mikezter/esphome-ikea-led-matrix`. Upstream `phiten/...` is fully merged and inactive. The `sascha-hemi` fork is deleted (404). `allenporter`'s fork only has the Frekvens driver. Nothing to pull from any of them.
- The Frekvens component was removed from this repo; recover it from history if ever needed.
