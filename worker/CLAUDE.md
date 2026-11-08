# Obegränsad Clock — Cloud Control

## What this is
A Cloudflare Worker that lets me control an IKEA Obegränsad 16×16 LED matrix
(running ESPHome on a Wemos D1 Mini / ESP8266) from the internet, without
opening any ports. The device polls the Worker; the Worker never reaches in.

## Architecture
- **Worker** (`src/index.js`, deployed via wrangler) serves:
  - `GET /`        → control webpage with buttons (the `PAGE` constant)
  - `GET /draw`    → 16×16 pixel editor webpage (the `DRAW_PAGE` constant)
  - `POST /set`    → sets displayed image; body `{img:<int>, ttl:<seconds>}`
  - `POST /reset`  → back to the clock immediately (device dismiss signal)
  - `GET /state`   → device polls this every 5s; returns a plain-text integer
  - `GET /img/<id>` → 16 newline-separated uint16 rows (MSB = leftmost pixel): ids 1..7
    from `src/IMAGES.js` (taken from the firmware's old images.h), id 12 = the free
    drawing; 404 otherwise. The device fetches the bitmap for the id it got from `/state`.
  - `GET/POST /custom` → read / store the free drawing (POST also switches to image 12)
- **Durable Object** `Panel` (binding `PANEL`, one instance `getByName("default")`,
  SQLite backend: the only DO backend on Workers Free). Stores `state`
  `{img, expiresAt}` and `custom_img` (16 rows) via `ctx.storage.kv`.
  Strongly consistent, unlike the KV namespace used before (old namespace
  `8e8eb8dbe0504f03a12626e460cdfcda` still exists, unbound). Auto-revert is
  server-side: when ttl elapses, `/state` returns 0 (clock mode).
- Free plan budget: 100k DO requests/day, 13k GB-s/day. Plain request handling
  without timers is hibernation-eligible, so duration is only the ms per request.
- Optional `TOKEN` secret gates `/set` via an `X-Token` header (currently unused).

## Device side (ESPHome, repo root)
- File: `../obegraensad-clock.yaml` (script `sync_panel`, every 5 s). Firmware docs: `../CLAUDE.md`.
- It does `http_request.get` on `/state` (see `../CLAUDE.md` for the constraints), and only if
  the id is a bitmap it does not have yet (or 12), a second `GET /img/<id>` in the same script,
  never inside `on_response`.
- Correct syntax for this ESPHome version: `response->status_code` (NOT `response_code`),
  and `body` is in scope as a std::string.
- Image indices: 0=clock 1=test 2=smiley 3=heart 4=cloud 5=sun 6=lightning 7=battery (bitmaps
  from the Worker), 8=matrix 9=tetris 10=snake (animations in the firmware), 11=all white
  (disabled), 12=free drawing. The physical button dismisses a shown image (POST /reset) or
  steps the brightness.

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
`npx wrangler deploy` (from `worker/`). Tests: `npx vitest run` (routes, expiry, custom drawing).

## Next planned feature
More library images (`src/IMAGES.js` + buttons in `PAGE.js`) now only need a Worker
deploy, no firmware flash. The device could cache the last ~5 fetched bitmaps in RAM
(5 × 32 B) to skip refetching.