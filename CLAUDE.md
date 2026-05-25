# Obegränsad Clock — Cloud Control

## What this is
A Cloudflare Worker that lets me control an IKEA Obegränsad 16×16 LED matrix
(running ESPHome on a Wemos D1 Mini / ESP8266) from the internet, without
opening any ports. The device polls the Worker; the Worker never reaches in.

## Architecture
- **Worker** (`worker.js`, deployed via wrangler) serves three things:
  - `GET /`        → control webpage with buttons (the `PAGE` constant)
  - `GET /draw`    → 16×16 pixel editor webpage (the `DRAW_PAGE` constant)
  - `POST /set`    → sets displayed image; body `{img:<int>, ttl:<seconds>}`
  - `GET /state`   → device polls this every 5s; returns a plain-text integer
- **KV namespace** bound as `CLOCK`, single key `"state"` holding
  `{img, expiresAt}`. Auto-revert is server-side: when ttl elapses,
  `/state` returns 0 (clock mode). Device stays dumb/stateless.
- Optional `TOKEN` secret gates `/set` via an `X-Token` header (currently unused).

## Device side (ESPHome, separate repo)
- File: `esphome-web-e75bc4.yaml` in `~/esphome-ikea-led-matrix/esphome_devices/`
- An `interval: 5s` does `http_request.get` on `/state` with
  `verify_ssl: false` (ESP8266 TLS against rotating *.workers.dev certs is
  fragile, so we don't pin).
- Lambda parses the body and sets global `id(image)`, clamped to `id(max_img)`
  (=11). Correct syntax for this ESPHome version: `response->status_code`
  (NOT `response_code`), and `body` is in scope as a std::string.
- Image indices: 0=clock 2=smiley 3=heart 4=cloud 5=sun 6=lightning
  7=battery 8=matrix 9=tetris. Physical button + next_image script still work;
  last cloud poll wins.

## Pixel editor (DRAW_PAGE)
- 16×16 grid, square cells, white-on-black theme.
- Geometry matches the REAL panel measurements: pixel 0.5", h-gap 0.28125",
  v-gap 0.6875" → at cell=24px, column-gap=14px, row-gap=33px (~27:40 ratio).
- Click/drag to paint; paint-vs-erase decided by the first cell touched.
- Outputs an `Image16x16 IMG_CUSTOM = {...}` block (one 16-bit hex word per row).
- bit order assumes MSB-first (bit 15 = leftmost column, c=0).
  If drawings come out mirrored L-R on the panel, change `(1 << (15 - c))`
  to `(1 << c)` in render().

## Deploy
`npx wrangler deploy`  (KV id lives in wrangler.jsonc)

## Next planned feature (not built yet)
Send custom drawings to the clock at runtime: POST the 16 row-words to the
Worker, store in KV, device fetches them and renders into a runtime buffer as
a new "custom" display mode — no firmware recompile needed. 16 words is
trivial for the ESP8266.