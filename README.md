# ikea-led-matrix

256 pixels. Three wires. One message.

This project turns the IKEA **Obegränsad** wall panel (and its sibling, the **Frekvens** cube) into a programmable, network-connected LED display using an ESP8266 and ESPHome. Wire up a D1 Mini, flash a config, and you have a living pixel object on your wall — showing the time, cycling through animations, or waiting quietly for a signal from someone who is thinking of you.

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

No image uploads. No elaborate accounts. A URL shared once, a panel hung once, a vocabulary of eight glowing things.

---

## Hardware

**IKEA Obegränsad** — 16×16 LED matrix wall panel  
**IKEA Frekvens** — 16×16 LED matrix cube (also supported)  
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
| Button       | GPIO 13      | Cycle images   |

---

## Getting started

**Requirements:** ESPHome ≥ 2025.11.0, a D1 Mini, WiFi credentials.

```bash
git clone https://github.com/sascha-hemi/esphome-ikea-led-matrix
cd esphome-ikea-led-matrix/esphome_devices

# Fill in your WiFi credentials
cp secrets.yaml.example secrets.yaml

# Flash
esphome run esphome-web-e75bc4.yaml
```

After flashing, cycle through images with the physical button on GPIO13, from the Home Assistant UI, or directly via the built-in web server at `http://<device-ip>`. OTA updates work out of the box.

### Minimal config — Frekvens clock

```yaml
esphome:
  name: frekvens-clock
  platform: ESP8266
  board: d1_mini
  platformio_options:
    lib_deps:
      - Wire
      - SPI
      - adafruit/Adafruit BusIO
      - adafruit/Adafruit GFX Library
      - me-no-dev/ESPAsyncTCP

external_components:
  - source: github://sascha-hemi/esphome-ikea-led-matrix@master
    components: [ frekvens_panel ]

time:
  - platform: sntp
    id: ntp_time
    timezone: 'Europe/Berlin'

font:
  - file: "04B03.ttf"
    id: b03
    size: 8

display:
  - platform: frekvens_panel
    latch_pin: 12
    clock_pin: 04
    data_pin: 05
    lambda: |-
      it.strftime(4, 0, id(b03), "%H", id(ntp_time).now());
      it.strftime(4, 8, id(b03), "%M", id(ntp_time).now());
```

### Minimal config — Obegränsad clock

```yaml
esphome:
  name: obegraensad-clock
  platform: ESP8266
  board: d1_mini
  platformio_options:
    lib_deps:
      - Wire
      - SPI
      - adafruit/Adafruit BusIO
      - adafruit/Adafruit GFX Library
      - me-no-dev/ESPAsyncTCP

external_components:
  - source: github://sascha-hemi/esphome-ikea-led-matrix@master
    components: [ obegraensad_panel ]

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

Every image lives in [esphome_devices/images.h](esphome_devices/images.h) as 16 rows of `uint16_t`. Bit 15 (MSB) is the leftmost pixel; `1` = on, `0` = off.

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
components/
  frekvens_panel/         — ESPHome component for the Frekvens cube
  obegraensad_panel/      — ESPHome component for the Obegränsad panel

esphome_devices/
  esphome-web-e75bc4.yaml — working device configuration
  images.h                — all bitmaps and animations (self-contained)
  04B03.ttf               — pixel font for the clock
```

---

## Known challenges — read before you build further

**NAT traversal is the hardest structural problem.** The panel sits behind a home router with no public IP. A web service cannot push to it directly. The clean solution is MQTT: both the panel and the service connect outward to a shared broker. The panel subscribes to a topic; the service publishes to it. This works reliably, scales to multiple panels, and keeps everything firewall-friendly. Choose this architecture early — retrofitting later is painful.

**WiFi provisioning for non-technical recipients.** ESPHome's fallback hotspot + captive portal is functional but not intuitive. If this is a gift, the gifter should configure it before handing it over: SSID, password, account pairing. A simple one-page setup guide that assumes no technical background would go a long way.

**ESP8266 WiFi interrupts and shift register timing.** The ESP8266 services WiFi in software, which can interrupt GPIO bit-banging mid-frame and cause occasional display glitches. Mostly cosmetic, but noticeable. An ESP32 eliminates this entirely (dedicated cores, hardware interrupt isolation) and costs only a little more.

**Images are baked into firmware.** Right now, the vocabulary of eight images is compiled in. Adding a ninth means reflashing every device. A better long-term approach: encode images as MQTT payloads (16 × uint16_t = 32 bytes, trivially small) and render on receipt. Then the image set lives serverside and is extensible without touching firmware.

**Authentication needs to live on the device.** If the web service can push any image to any panel, the device needs to verify the source. The minimal approach: a random secret token baked into `secrets.yaml` at flash time, included in every MQTT message. The panel checks it; unknown senders are dropped.

**Rate limiting matters more than you expect.** Without it, someone can send a hundred hearts in five minutes. Enforce limits at the service layer (N messages per sender per hour) and optionally on the device too (ignore messages arriving within X seconds of the last).

**The Adafruit GFX dependency is carrying weight it doesn't earn.** The current driver inherits from `Adafruit_GFX`, pulling in `Wire`, `SPI`, and `Adafruit BusIO`. The Obegränsad doesn't use any of it — the display is a shift register that needs only `digitalWrite`. Removing this dependency is the highest-value refactor available: faster compilation, fewer moving parts, nothing external to break.

**Designing images without an aspect-ratio-aware tool is error-prone.** Standard pixel editors preview at 1:1, so Obegränsad images look wrong until they hit hardware. A browser tool that previews stretched 2× vertically and exports to `uint16_t[16]` would significantly lower the barrier for contributors.

---

## Contributing

Pull requests welcome. The most valuable contributions right now:

- **Driver rewrite** — remove Adafruit GFX from `obegraensad_panel`; direct GPIO calls only
- **MQTT command receiver** — a working ESPHome pattern for receiving image commands from a web service
- **New bitmaps** — 16×16, designed with 2:1 vertical preview, encoded as `uint16_t[16]` MSB-first
- **Pixel editor** — browser tool with correct Obegränsad aspect ratio preview, exports to bitmap format

---

*Hardware: IKEA Obegränsad / Frekvens · Firmware: ESPHome on ESP8266/ESP32 · Protocol: shift register, three wires*
