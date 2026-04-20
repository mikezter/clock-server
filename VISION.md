# Project Vision — IKEA LED Matrix as a Communication Object

> This document is a living brief: product thinking, technical architecture, known constraints, and open questions. Written for the author and for any AI collaborator entering this project cold.

---

## What this actually is

A 16×16 binary LED matrix — IKEA Obegränsad, ~30€, white, ~30cm square — connected to an ESP8266 microcontroller via three GPIO pins. The display speaks a shift-register protocol: clock bits in serially, latch to commit. That's the whole hardware story.

The software today is an ESPHome custom component. ESPHome is a YAML-driven firmware framework for ESP microcontrollers, primarily used with Home Assistant. It handles WiFi, OTA updates, an API layer, and a display buffer abstraction. The project plugs in as an external component that implements `DisplayBuffer`.

The display currently shows:
- A live clock (NTP-sourced, pixel font)
- 7 hand-crafted 16×16 bitmaps (heart, smiley, sun, cloud, lightning bolt, battery, all-white)
- 3 frame-based animations (matrix rain, Tetris, border snake)

Images are cycled via a physical button (GPIO13), via Home Assistant, or via the built-in ESPHome web server. Brightness is controlled by PWM on GPIO14 through the ESPHome monochromatic light component.

This is a functional, working tinkerer's project. The vision is to make it something more.

---

## The product idea

The panel is a physical presence on someone's wall. It doesn't demand attention — it glows softly, shows the time, runs an animation. It is ambient, not intrusive.

The idea: let one person send one of eight pre-defined images to the panel from anywhere in the world. A sender opens a URL, picks a symbol, taps send. The panel changes. That's it.

Think of it as a physical notification that bypasses every app, lock screen, and notification center. A heart appears on the wall. A sun. A lightning bolt. No sound, no vibration, no reply expected. Just light, in a shape, that means something between two people.

This is not a messaging app. It is closer to a signal fire. The constraint — only eight possible images — is intentional. It forces the vocabulary to be personal and agreed-upon by the people involved.

**Use cases (current thinking):**
- Couple gift: send a heart from across the city, just because
- Parent/child: a sun every morning means "I'm up, all good"
- Self-signaling: use it as a personal ambient dashboard (weather, mood, status)
- Office presence: a symbol on a colleague's desk that says "in flow, don't interrupt"

The panel can be given as a gift. The gifter sets it up, pairs it to their account, hands it over. The recipient plugs it in. From that point, the gifter can send signals whenever they want. The recipient can only watch — or hit the physical button to cycle locally.

---

## Technical architecture

### Current state

```
[ESPHome YAML config]
  |
  ├── external_components: obegraensad_panel (this repo)
  |     ├── obegraensad-driver.cpp   — shift register protocol
  |     ├── obegraensad-panel.cpp    — ESPHome DisplayBuffer impl
  |     └── obegraensad-driver.h     — coordinate mapping (serpentine lookup tables)
  |
  ├── images.h                        — compile-time bitmaps + animations
  ├── display lambda                  — selects image by global int `image`
  ├── binary_sensor (GPIO13)          — physical button → next_image script
  ├── light/output (GPIO14)           — PWM brightness via HA
  └── web_server (port 80)            — local HTTP control
```

**Dependencies (PlatformIO lib_deps):**
- `Wire` — pulled in by Adafruit GFX
- `SPI` — pulled in by Adafruit GFX
- `adafruit/Adafruit BusIO` — pulled in by Adafruit GFX
- `adafruit/Adafruit GFX Library` — base class for the driver ← **unnecessary**
- `me-no-dev/ESPAsyncTCP` — async TCP for OTA / web server

**The Adafruit GFX problem:** The driver inherits from `Adafruit_GFX` to get `drawPixel`, `drawLine`, etc. But ESPHome's `DisplayBuffer` already provides all drawing primitives through its own abstraction — and the Obegränsad's hardware only needs `digitalWrite` calls to talk to the shift register. The entire Adafruit stack is dead weight. Removing it cuts compile time, eliminates three external dependencies, and makes the code self-explanatory.

---

### Target architecture (MVP)

```
[Sender's browser / phone]
  |
  | HTTPS POST /send
  | { sender_token, image_id (0–7) }
  v
[Web service — stateless, minimal]
  |
  | Validate sender_token against stored pairing
  | Rate limit (N per hour per sender)
  | Publish MQTT message to device topic
  v
[MQTT broker — public or self-hosted]
  |
  | topic: panels/{device_id}/command
  | payload: { image_id: 3, token: "..." }
  v
[ESP8266 — subscribes on boot]
  |
  | Verify token matches stored secret
  | Update global `image` variable
  | Display renders on next update cycle (100ms)
  v
[Obegränsad panel — shows the image, holds it]
```

**One account. One panel. Eight images. That's the MVP.**

No sender accounts initially — just a shared URL/token the gifter uses. No recipient interaction required beyond having the panel plugged in.

---

## The eight images — current set

Each image is a deliberate choice. The vocabulary should be small enough to be memorized and personal enough to carry meaning.

| ID | Image      | Intended signal              |
|----|------------|------------------------------|
| 0  | Clock      | Always-on default (no signal) |
| 1  | Heart      | Thinking of you              |
| 2  | Smiley     | Good day / hello             |
| 3  | Sun        | Morning / bright energy      |
| 4  | Cloud      | Moody, but okay              |
| 5  | Lightning  | Energized / heads up         |
| 6  | Battery    | Fully charged / I've got this |
| 7  | [reserved] | TBD — custom per pair?       |

The 8th slot is intentionally left open. One option: make it pair-specific — the gifter and recipient agree on what it means when they set up the panel.

**Image format:** `uint16_t[16]`, 16 rows, MSB = leftmost pixel. Stored in `images.h` as compile-time constants. Each image is designed squat (horizontally compressed) to render correctly on the Obegränsad's ~2:1 vertical-to-horizontal pixel spacing.

---

## Hardware notes

### Obegränsad display wiring (serpentine)

The Obegränsad does not wire LEDs in a simple row-major order. The physical LED matrix uses a serpentine pattern: even and odd columns run in opposite directions, and the display is split into top (rows 0–7) and bottom (rows 8–15) halves with different indexing. Two lookup tables (`lookupTop[]`, `lookupBottom[]`) in `obegraensad-driver.cpp` map visual (x, y) coordinates to physical LED indices.

This is the trickiest part of the driver. Any rewrite must preserve this mapping exactly, or images will render scrambled.

### ESP8266 vs ESP32

The current config targets an ESP8266 (D1 Mini). The ESP8266 services WiFi in software and can interrupt GPIO bit-banging mid-frame, causing display glitches. An ESP32 resolves this with hardware interrupt isolation and dual cores. For a product context, ESP32 is the better target.

---

## The driver rewrite — design intent

The current driver inherits from `Adafruit_GFX`. The target is an ESPHome native component that:

1. Extends `esphome::display::DisplayBuffer` directly (ESPHome's own base class)
2. Implements only `draw_absolute_pixel_internal(x, y, color)` — one function
3. Sends frames to the shift register using raw `digitalWrite` / `delayMicroseconds` calls
4. Has zero external library dependencies beyond ESPHome core

The display update cycle:
```
update() called by ESPHome (every 100ms)
  → do_update_()        — runs the display lambda, fills internal pixel buffer
  → display()           — copies buffer to driver
     → clear()          — zero the shift register buffer
     → drawPixel(x,y)   — set bits in buffer per pixel
     → scan()           — clock all 256 bits out to shift register, then latch
```

The `scan()` function is timing-sensitive: 16 bits per row × 16 rows = 256 serial clock pulses, each ~1µs apart. Total frame time: ~512µs. This should not be interrupted.

---

## Web service design (MVP)

**Stack choice is open** — the service is so simple that language/framework barely matters. Python/FastAPI, Node/Express, Go net/http — any of these works. The service is effectively:

```
POST /send
  body: { token: string, image_id: int (0–7) }

  1. Look up token → get (device_id, rate_limit_state)
  2. Check rate limit
  3. Publish MQTT: topic=panels/{device_id}/command, payload={image_id, token}
  4. Return 200 OK or 429 Too Many Requests
```

**State the service needs to store:**
- `pairings`: token → device_id (set at flash time, never changes)
- `rate_limit`: token → [timestamps of recent sends]

A SQLite file or even a flat JSON file is sufficient for one panel. Scale when needed.

**MQTT broker:** Use HiveMQ Cloud free tier or Mosquitto on a VPS for MVP. The panel connects outbound on port 8883 (MQTT over TLS). This solves NAT traversal without any port forwarding or tunneling on the recipient's network.

**ESPHome MQTT config (sketch):**
```yaml
mqtt:
  broker: your-broker.hivemq.cloud
  port: 8883
  username: !secret mqtt_username
  password: !secret mqtt_password
  on_message:
    - topic: panels/my-device-id/command
      then:
        - lambda: |-
            // parse payload, verify token, set id(image)
```

---

## What the firmware needs to do (v1.0 target)

1. Connect to WiFi on boot
2. Subscribe to MQTT topic `panels/{device_id}/command`
3. On message: verify token, extract `image_id`, update display global
4. Show clock when no message has been received (idle state)
5. Hold the received image until a new message arrives or the button is pressed
6. Enforce a cooldown: ignore messages arriving within 60 seconds of the last one
7. OTA update capability (ESPHome handles this)

The firmware should be stable enough that it never needs updating after the initial flash. That means: no hardcoded image set assumptions, token-based auth, and a well-defined MQTT payload schema that can evolve.

---

## Known open problems

### Provisioning
How does a non-technical recipient get the device on their WiFi? Options:
- **Gifter configures before gifting** — simplest; requires knowing the SSID/password in advance
- **ESPHome captive portal** — fallback hotspot, browser-based config; works but confusing
- **Improv WiFi** (BLE provisioning standard ESPHome supports) — clean UX, requires BLE-capable chip (ESP32 only)

Decision for MVP: gifter configures. Document clearly.

### Image extensibility
Current images are compile-time constants. If the vocabulary needs to change, every device reflashes. Two paths forward:

- **Option A:** Accept the constraint. Eight images, chosen carefully, defined forever at flash time. The vocabulary is the product.
- **Option B:** Send image payloads over MQTT (32 bytes). The set becomes serverside-defined, devices never reflash for content changes.

Option B is more powerful but adds complexity to the firmware parser. Option A is simpler and arguably more intentional for a gift product. Decide before writing the MQTT integration.

### Authentication scope
The current idea: one shared secret token per panel, baked into firmware. The gifter holds the token (it's part of their account). The recipient doesn't need one.

Future complication: what if the recipient wants to send back? Or wants to block senders? Defer this entirely for MVP — one-directional by design.

### Rate limiting — where it lives
Both service-side and device-side rate limiting make sense but for different reasons:
- Service-side: prevents abuse, protects the MQTT broker, gives feedback to sender (429 response)
- Device-side: prevents display seizures if the broker is compromised or if service-side fails

Both should exist. Service: N per sender per hour. Device: minimum 60-second gap between displayed images.

### The pixel editor
Every image needs to be designed for the 2:1 pixel aspect ratio of the Obegränsad. No standard tool handles this. A browser-based editor (Canvas API, ~200 lines of JS) that:
- Renders a 16×16 grid with cells 1× wide, 2× tall
- Exports as `uint16_t[16]` C array
- Optionally: sends directly to the panel for live preview

This is a small but high-value piece of tooling. Build it early.

---

## Design principles

These should guide every decision:

1. **Every dependency removed is a problem prevented.** Start from zero and add only what is necessary.
2. **The eight-image constraint is a feature.** Scarcity creates meaning. Don't expand the vocabulary just because you can.
3. **The panel works offline.** Clock mode, animations, local button — all function without any network or service.
4. **Firmware updates should be rare after v1.0.** Design the MQTT schema and auth to be stable. Prefer serverside changes over reflashing.
5. **The gifter sets it up. The recipient just receives.** The UX asymmetry is intentional — one person takes the complexity so the other doesn't have to.
6. **Build the thing that exists, not the thing you imagine.** The Obegränsad is a constrained, beautiful object. Design with the constraints, not against them.

---

## Phases

### Phase 0 — Current (done)
Working ESPHome component, local display, images, animations, HA integration.

### Phase 1 — Clean driver
Remove Adafruit GFX dependency. Rewrite `obegraensad_panel` as a pure ESPHome component with direct GPIO calls. Verify all images render correctly. No new features — just a better foundation.

### Phase 2 — MQTT integration on device
Add MQTT subscription to ESPHome config. Device listens for image commands. Token verification in lambda. Local button still works. No web service yet — test by publishing to the broker manually.

### Phase 3 — Web service MVP
Minimal stateless service: POST endpoint, token lookup, MQTT publish, rate limiting. One sender, one panel. No frontend yet — curl or a shared URL is sufficient to validate the concept.

### Phase 4 — Sender UI
A single-page app (or even a static HTML form): pick one of eight images, hit send. Shareable URL with sender token embedded. No login required for the sender.

### Phase 5 — Image payloads (optional)
Move image definitions serverside. Firmware renders 32-byte MQTT payloads directly. Enables vocabulary changes without reflashing. Evaluate need based on Phase 3/4 learnings.

---

## What this is not

- Not a messaging app. No text, no two-way communication, no delivery receipts.
- Not a smart home dashboard. There are better tools for that.
- Not a product with network effects. One panel, one person. That's the point.
- Not trying to replace a phone notification. It's trying to exist alongside silence.

---

*Last updated: April 2026*
