# ikea-led-matrix

256 pixels. Three wires. One message.

This project turns the IKEA **Obegränsad** wall panel into a programmable, network-connected LED display using an ESP8266 and ESPHome. Wire up a D1 Mini, flash a config, and you have a living pixel object on your wall — showing the time, cycling through animations, or waiting quietly for a signal from someone who is thinking of you.

The hardware costs less than a good dinner. The protocol is three GPIO pins and a shift register. Everything else is yours to design.

---

## What it shows

Eight hand-crafted 16×16 bitmaps form the visual vocabulary, each tuned to compensate for the Obegränsad's 2:1 vertical pixel spacing so they look correct on actual hardware:

```
heart · smiley · sun · cloud · lightning · battery · [clock] · [yours]
```

Three animations fill the space in between — a matrix rain with fading trails, a self-playing Tetris board, a border-crawling snake — all built on frame-based timing with simulated brightness levels baked into the draw loop, no hardware PWM required.

The clock pulls from NTP and always knows what time it is.

---

## The idea at the center

Imagine giving someone a panel as a gift. They hang it on their wall. You keep one.

You open a URL on your phone, pick an image — a sun, a heart, a lightning bolt — and tap send. Their panel lights up. No notification sound, no screen to unlock, no message to interpret. Just light, in a shape, that means something between you two.

That's the web service this project is building toward: one sender, one panel, eight possible signals. Simple enough to explain in a sentence. Personal enough to matter.

```
[ you, anywhere ]  →  [ web service ]  →  [ MQTT broker ]  →  [ their panel ]
```

**Today** the panel polls a Cloudflare Worker instead (`clock-server.mikezter.workers.dev`): `GET /state` every 5 s returns an image index (0 = clock), `GET /img/<id>` returns the 16 rows of that image (the bitmaps live in the Worker, not in the firmware; image 12 is the free drawing), and `POST /reset` clears the state when the image is dismissed on the panel. Polling keeps the panel behind NAT without a broker; MQTT stays the target for push and many panels.

No image uploads. No elaborate accounts. A URL shared once, a panel hung once, a vocabulary of eight glowing things.

---

## Hardware

**IKEA Obegränsad** — 16×16 LED matrix wall panel  
**Wemos D1 Mini** (ESP8266) or any ESP32 board  
Three dupont wires and an hour

The display communicates via a serial shift register: bits are clocked in one at a time over Data + Clock, then a Latch pulse commits the whole frame at once. Three pins doing exactly what they need to do, nothing more.

### Wiring — Obegränsad

| Panel signal | D1 Mini GPIO  | Purpose        |
|-------------|--------------|----------------|
| Latch        | GPIO 12      | Frame commit   |
| Clock        | GPIO 4       | Serial clock   |
| Data         | GPIO 5       | Serial data    |
| Brightness   | GPIO 14 (inv)| PWM dimming    |
| Button       | GPIO 13      | Dismiss image / cycle brightness |

---

## Getting started

**Requirements:** ESPHome ≥ 2025.11.0, a D1 Mini, WiFi credentials.

```bash
git clone https://github.com/mikezter/esphome-ikea-led-matrix
cd esphome-ikea-led-matrix

# Fill in your WiFi credentials
cp secrets.yaml.example secrets.yaml

# Flash
esphome run obegraensad-clock.yaml
```

The repo root is the ESPHome config directory. `obegraensad-clock.yaml` loads the driver from the local `components/` folder, so changes to the driver are picked up on the next build without pushing. To run the ESPHome Device Builder against it: `esphome-device-builder .`

After flashing, the panel shows the clock and switches to whatever image the Worker reports. The physical button on GPIO13 dismisses a shown image (back to the clock) or, on the clock, steps through the brightness stages (off → 1 → 5 → 20 → 60 → 239 on a 0–239 scale, 0 = really off). Home Assistant and the built-in web server at `http://<device-ip>` expose the brightness slider, an on/off switch, a "Dimmstufe weiter" and a "Back to Clock" button and a free-heap sensor. OTA updates work out of the box.

### Minimal config — Obegränsad clock

To use the component from your own config without cloning, pull it from GitHub:

```yaml
esphome:
  name: obegraensad-clock

external_components:
  - source: github://mikezter/esphome-ikea-led-matrix@master
    components: [ obegraensad_panel ]

esp8266:
  board: d1_mini

time:
  - platform: sntp
    id: ntp_time
    timezone: 'Europe/Berlin'

font:
  - file: "04B03.ttf"
    id: b03
    size: 8

display:
  - platform: obegraensad_panel
    rotation: 90
    latch_pin: 12
    clock_pin: 04
    data_pin: 05
    lambda: |-
      it.strftime(4, 0, id(b03), "%H", id(ntp_time).now());
      it.strftime(4, 8, id(b03), "%M", id(ntp_time).now());
```

---

## Adding your own images

Every image is 16 rows of `uint16_t`, stored in the Worker (`clock-server/src/IMAGES.js`) and fetched by the panel on demand (the old C arrays are in this repo's git history, `images.h` keeps only the animations). Bit 15 (MSB) is the leftmost pixel; `1` = on, `0` = off.

```cpp
const Image16x16 IMG_HEART = {
  0b0111001110000000,  // row 2 — top lobes
  0b1111111111000000,  // row 3
  // ...
  0b0000001100000000,  // row 11 — tip
};
```

**Critical:** the Obegränsad's LEDs are physically spaced roughly twice as tall as wide. Design your bitmaps squat — horizontally compressed — so they look proportional on hardware. All included images account for this.

Draw at 16×16, preview stretched 2× vertically, encode as `uint16_t[16]`, add a `case` to the display lambda.

---

## Project structure

```
obegraensad-clock.yaml   — working device configuration
images.h                 — the frame-based animations (bitmaps come from the Worker)
04B03.ttf                — pixel font for the clock
secrets.yaml.example     — template for secrets.yaml (gitignored)
components/
  obegraensad_panel/     — ESPHome display component for the Obegränsad panel
```

---

## The driver

`components/obegraensad_panel` is one small native ESPHome display (rewritten Nov 2026):

- Subclasses ESPHome's `DisplayBuffer`; rotation, clipping, fonts and the drawing API come from ESPHome.
- The frame is 16 × `uint16_t` (32 bytes) already in shift-out order, so drawing a pixel sets one bit and nothing gets copied per frame.
- Pins are ESPHome pins (they show up in the startup config log). The shift-out loop writes GPIO registers directly through `ISRInternalGPIOPin`, skipping Arduino `digitalWrite` and its per-call waveform/PWM checks. Clock and latch pulses stay 1 µs high, as before.
- No `lib_deps`. Adafruit GFX, BusIO, Wire and SPI are gone (flash −4.9 KB, ~330 B less heap). `web_server` still pulls in ESPAsyncTCP itself.
- Builds on Arduino and ESP-IDF.

The serpentine LED mapping (the `LOOKUP_TOP` / `LOOKUP_BOTTOM` tables) is copied unchanged from the original driver. The rewrite was checked on the host against the old Adafruit-based driver by recording every data/clock/latch write of both: identical for all 256 single pixels, 2000 random frames, all on and all off.

**Performance:** sending a frame is ~256 µs of clock pulses plus ~770 register writes, a fraction of a millisecond every 100 ms (estimated, not measured on the device). Frames are sent on every update on purpose: if one gets corrupted, the next fixes it within 100 ms.

**Hardware SPI** would be the cleanest next step: the panel protocol is SPI mode 0, LSB first, with latch as a pulse after the 32 bytes. The component would become an `SPIDevice` and a frame one 32-byte `write_array()`. On the ESP8266 hardware SPI needs fixed pins: clock GPIO14, data GPIO13, and `SPI.begin()` also takes GPIO12. That means moving data, clock, latch (e.g. to GPIO15), the button and the PWM output. ESPHome's software SPI on the current pins would be slower than the direct writes. On an ESP32 any pins work.

---

## Known challenges — read before you build further

**NAT traversal is the hardest structural problem.** The panel sits behind a home router with no public IP. A web service cannot push to it directly. The clean solution is MQTT: both the panel and the service connect outward to a shared broker. The panel subscribes to a topic; the service publishes to it. This works reliably, scales to multiple panels, and keeps everything firewall-friendly. Choose this architecture early — retrofitting later is painful.

**WiFi provisioning for non-technical recipients.** ESPHome's fallback hotspot + captive portal is functional but not intuitive. If this is a gift, the gifter should configure it before handing it over: SSID, password, account pairing. A simple one-page setup guide that assumes no technical background would go a long way.

**ESP8266 WiFi interrupts and shift register timing.** The ESP8266 services WiFi in software, which can interrupt GPIO bit-banging mid-frame and cause occasional display glitches. The direct register writes shrink that window; hardware SPI or an ESP32 would close it.

**ESP8266 networking is fragile.** Starting an HTTP request inside another request's `on_response` crashed the device (watchdog reset), and two TLS sessions at once don't fit in the heap. Keep requests strictly in sequence. The all-white image (case 11) is disabled because WiFi dropped while it was shown, most likely because all 256 LEDs on draw too much current (not verified).

**Images are baked into firmware.** Right now, the vocabulary of eight images is compiled in. Adding a ninth means reflashing every device. A better long-term approach: encode images as MQTT payloads (16 × uint16_t = 32 bytes, trivially small) and render on receipt. Then the image set lives serverside and is extensible without touching firmware.

**Authentication needs to live on the device.** If the web service can push any image to any panel, the device needs to verify the source. The minimal approach: a random secret token baked into `secrets.yaml` at flash time, included in every MQTT message. The panel checks it; unknown senders are dropped.

**Rate limiting matters more than you expect.** Without it, someone can send a hundred hearts in five minutes. Enforce limits at the service layer (N messages per sender per hour) and optionally on the device too (ignore messages arriving within X seconds of the last).

**Designing images without an aspect-ratio-aware tool is error-prone.** Standard pixel editors preview at 1:1, so Obegränsad images look wrong until they hit hardware. A browser tool that previews stretched 2× vertically and exports to `uint16_t[16]` would significantly lower the barrier for contributors.

---

## Lineage

Forked from [phiten/esphome-ikea-led-matrix](https://github.com/phiten/esphome-ikea-led-matrix) (Frekvens driver by frumperino, Obegränsad port by phiten). Everything from upstream is merged; it has had no new commits since April 2024. The sascha-hemi fork, which earlier configs pulled the component from, is deleted. allenporter's fork, the only other active one (Oct 2026), keeps just the Frekvens driver; its Adafruit GFX removal was the reference for this rewrite. This repo dropped the Frekvens component.

---

## Contributing

Pull requests welcome. The most valuable contributions right now:

- **Hardware SPI** — `SPIDevice` variant of the driver for ESP32 or rewired ESP8266 boards (see "The driver")
- **MQTT command receiver** — a working ESPHome pattern for receiving image commands from a web service
- **New bitmaps** — 16×16, designed with 2:1 vertical preview, encoded as `uint16_t[16]` MSB-first
- **Pixel editor** — browser tool with correct Obegränsad aspect ratio preview, exports to bitmap format

---

*Hardware: IKEA Obegränsad · Firmware: ESPHome on ESP8266/ESP32 · Protocol: shift register, three wires*
