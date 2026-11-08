# clock-server

256 pixels. Three wires. One message.

Turns the IKEA **Obegränsad** 16×16 LED wall panel into a network-connected pixel display: an ESP8266 running ESPHome shows the time, and a small Cloudflare Worker tells it when to show something else instead: an image, an animation, a drawing, or the temperature at home.

```
[ phone / browser ] ──POST──▶ [ Cloudflare Worker ] ◀──poll every 5 s── [ panel (ESP8266) ]
[ panel-climate   ] ──POST──▶        (state in a Durable Object)
```

The panel only makes outbound requests, so it works behind NAT without a broker or open ports.

## What's in the repo

| Path | What |
|------|------|
| `obegraensad-clock.yaml` | Main device: clock + whatever the Worker asks for |
| `obegraensad-simple.yaml` | Minimal second device: clock and dimming only, no network services |
| `components/obegraensad_panel/` | Native ESPHome display driver for the panel |
| `images.h` | The firmware animations (matrix rain, Tetris, snake) |
| `worker/` | Cloudflare Worker: control page, pixel editor, image library, panel state |
| `climate/` | Go service that shows SwitchBot temperature/humidity on the panel |
| `build.sh` | `esphome` wrapper with a shared build cache |

## What the panel shows

Image ids, as returned by the Worker's `GET /state`:

| Id | Content | Lives in |
|----|---------|----------|
| 0 | Clock (NTP, Europe/Berlin) | firmware |
| 1–7 | Test pattern, smiley, heart, cloud, sun, lightning, battery | Worker (`worker/src/IMAGES.js`) |
| 8–10 | Matrix rain, Tetris, snake | firmware (`images.h`) |
| 11 | All white: disabled, WiFi dropped while it was shown | — |
| 12 | Free drawing from the pixel editor | Worker (Durable Object) |

Bitmaps are fetched on demand from `GET /img/<id>` (16 lines, one `uint16_t` per row, MSB = leftmost pixel). New library images therefore only need a Worker deploy, no reflash. The panel keeps only the current bitmap in RAM; image 12 is refetched when its revision changes.

Images expire on the Worker (TTL), then the panel goes back to the clock.

## Hardware

- IKEA Obegränsad
- Wemos D1 Mini (ESP8266)
- Five wires to the panel's controller board:

| Panel signal | GPIO | |
|--------------|------|---|
| Latch | 12 | frame commit |
| Clock | 4 | serial clock |
| Data | 5 | serial data |
| Enable / brightness | 14 | PWM, inverted, 300 Hz |
| Button | 13 | input, pull-up, inverted |

The LEDs are spaced about twice as far apart vertically as horizontally, so bitmaps are drawn squat. The pixel editor previews with the real spacing.

## Firmware

Requires ESPHome ≥ 2025.11.0. The repo root is the ESPHome config directory.

```bash
cp secrets.yaml.example secrets.yaml      # WiFi + fallback hotspot password
esphome run obegraensad-clock.yaml        # or ./build.sh run obegraensad-clock.yaml
```

The Worker URL (`clock-server.mikezter.workers.dev`) is hardcoded in `obegraensad-clock.yaml`; change it if you deploy your own. Polling uses plain HTTP on purpose: a TLS handshake every 5 s tripped the ESP8266's watchdog.

**Button:** while an image is shown, it dismisses it (back to the clock, `POST /reset`). On the clock it steps the brightness: off → 1 → 5 → 20 → 60 → 239.

**Home Assistant / web UI** (`http://<device-ip>`): brightness slider (0 = off, 1–239 = PWM 17–255/255), on/off switch, "Dimmstufe weiter" and "Back to Clock" buttons, free-heap sensor. OTA works as usual.

To use just the driver in your own config:

```yaml
external_components:
  - source: github://mikezter/clock-server@master
    components: [ obegraensad_panel ]

display:
  - platform: obegraensad_panel
    rotation: 90
    latch_pin: 12
    clock_pin: 4
    data_pin: 5
```

`obegraensad-simple.yaml` is a complete minimal example.

## Worker

`worker/` is the Cloudflare Worker `clock-server` (runs on Workers Free):

- `GET /`: control page (buttons for the library images, matrix, Tetris and back to clock; images show for 60 s)
- `GET /draw`: 16×16 pixel editor with the panel's real aspect ratio
- `POST /set` `{img, ttl}`, `POST /reset`, `GET /state`, `GET /img/<id>`, `GET|POST /custom`

State is kept in a SQLite Durable Object (strongly consistent). Details in `worker/CLAUDE.md`.

```bash
cd worker
npx vitest run         # tests
npx wrangler deploy
```

## Climate display

`climate/` is `panel-climate`, a small Go service for a Linux box with Bluetooth. It reads two SwitchBot meters (living room, freezer) from their BLE advertisements via BlueZ, no pairing. Every 15 minutes it puts temperature and humidity on the panel for one minute, alternating between the meters every 15 s, then restores whatever was shown before.

It needs no firmware support: the frame is rendered in Go and sent to the Worker as the free drawing (image 12). A dot bottom left marks which meter (1st or 2nd position), a dot bottom right means the value is over an hour old, and `--` means no reading yet.

```bash
cd climate && go build -o panel-climate .
./panel-climate -print                       # scan once, print frames, don't touch the panel
systemctl --user enable --now panel-climate  # unit: climate/panel-climate.service
systemctl --user reload panel-climate        # show now
```

Note: a meter that is connected to the SwitchBot app stops advertising meanwhile.

## The driver

`components/obegraensad_panel` is a native ESPHome `DisplayBuffer` (rewritten Nov 2026, no Adafruit GFX, no `lib_deps`). The frame is 16 × `uint16_t` already in shift-out order; the shift-out writes GPIO registers directly instead of going through Arduino `digitalWrite`. A frame is sent every 100 ms even if unchanged, so a glitched frame is fixed right away. The rewrite was verified on the host to produce bit-identical pin writes to the old driver.

Possible next step: hardware SPI (mode 0, LSB first, latch after 32 bytes). On the ESP8266 that needs rewiring to clock GPIO14 / data GPIO13; on an ESP32 any pins work.

## Known limitations

- **ESP8266 heap:** only one HTTP request at a time, never one started inside another's `on_response` (crashed the device).
- **Flicker at partial brightness:** 300 Hz PWM is the best found (1 kHz and 5 kHz were worse); some remains.
- **No auth yet:** `/set` can be gated by an optional `TOKEN` secret (`X-Token` header), currently unused.
- **Polling, not push:** up to 5 s delay. MQTT remains an option for push and many panels; see `VISION.md`.

## Lineage

Started as a fork of [phiten/esphome-ikea-led-matrix](https://github.com/phiten/esphome-ikea-led-matrix) (Frekvens driver by frumperino, Obegränsad port by phiten). In Nov 2026 the firmware repo (`mikezter/esphome-ikea-led-matrix`, archived) and the Worker repo were merged into this monorepo with both histories kept. The Frekvens component was dropped.

Product vision and roadmap: [`VISION.md`](VISION.md).
