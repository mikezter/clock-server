// Obegränsad clock controller — Cloudflare Worker
//
// Routes:
//   GET  /        -> control webpage with buttons
//   POST /set     -> set the displayed image  body: {img: <int>, ttl: <seconds>}
//   GET  /state   -> device polls this; returns {img: <int>} honoring expiry
//
// State lives in one SQLite-backed Durable Object (class Panel, binding PANEL):
// reads are strongly consistent, unlike KV (up to ~60 s stale across edges).
// Optional: set a secret TOKEN to protect /set (Settings > Variables, or `wrangler secret put TOKEN`).

import { DRAW_PAGE } from "./DRAW_PAGE";
import { PAGE } from "./PAGE";
import { IMAGES } from "./IMAGES";
import { DurableObject } from "cloudflare:workers";

const DEFAULT_IMG = 0;      // 0 = clock mode (what we revert to)
const DEFAULT_TTL = 60;     // seconds an image stays before reverting
const CUSTOM_IMG = 12;      // image index of the free drawing

// One panel = one Durable Object. Storage uses the synchronous KV API of the
// SQLite backend (the only backend on the Workers Free plan). No timers or
// open I/O, so the object is hibernation-eligible between requests and only
// the few ms per request count as duration.
export class Panel extends DurableObject {
  // Current image index, honoring expiry (0 = clock).
  getImg() {
    const s = this.ctx.storage.kv.get("state");
    if (!s) return DEFAULT_IMG;
    if (s.expiresAt && Date.now() >= s.expiresAt) return DEFAULT_IMG;
    return s.img;
  }

  // ttl <= 0 means "stay forever until changed".
  setImg(img, ttl) {
    const state = { img, expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null };
    this.ctx.storage.kv.put("state", state);
    return state;
  }

  reset() {
    this.ctx.storage.kv.put("state", { img: DEFAULT_IMG, expiresAt: null });
  }

  getCustom() {
    return this.ctx.storage.kv.get("custom_img") ?? new Array(16).fill(0);
  }

  // Bumped on every new drawing so the device can tell "same 12" from "new 12".
  getRev() {
    return this.ctx.storage.kv.get("custom_rev") ?? 0;
  }

  // Store the drawing and show it, in one synchronous (atomic) step.
  setCustom(rows) {
    this.ctx.storage.kv.put("custom_img", rows);
    this.ctx.storage.kv.put("custom_rev", this.getRev() + 1);
    this.ctx.storage.kv.put("state", { img: CUSTOM_IMG, expiresAt: null });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const panel = env.PANEL.getByName("default");
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Token",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // --- Device polls here ---
    if (url.pathname === "/state") {
      const img = await panel.getImg();
      // Plain integer keeps ESP8266 parsing trivial. For the free drawing the
      // drawing's revision follows ("12 7"): the device refetches /img/12 only
      // when it changes. atoi() on the body still reads just the image index.
      const body = img === CUSTOM_IMG ? `${img} ${await panel.getRev()}` : String(img);
      return new Response(body, {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", ...cors },
      });
    }

    // --- Webpage / app sets the image here ---
    if (url.pathname === "/set" && request.method === "POST") {
      // Optional shared-secret check.
      if (env.TOKEN) {
        const sent = request.headers.get("X-Token");
        if (sent !== env.TOKEN) {
          return new Response("forbidden", { status: 403, headers: cors });
        }
      }
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400, headers: cors });
      }
      const img = Number.isInteger(body.img) ? body.img : DEFAULT_IMG;
      const ttl = Number.isInteger(body.ttl) ? body.ttl : DEFAULT_TTL;
      const state = await panel.setImg(img, ttl);
      return new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // --- Reset to clock mode immediately (device dismiss signal) ---
    if (url.pathname === "/reset" && request.method === "POST") {
      await panel.reset();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // --- Control webpage ---
    if (url.pathname === "/") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    // --- Pixel drawing editor ---
    if (url.pathname === "/draw") {
      return new Response(DRAW_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/custom" && request.method === "GET") {
      const rows = await panel.getCustom();
      return new Response(rows.join("\n"), {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", ...cors },
      });
    }

    if (url.pathname === "/custom" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400, headers: cors });
      }
      const rows = body.rows;
      if (!Array.isArray(rows) || rows.length !== 16 || !rows.every(v => Number.isInteger(v) && v >= 0 && v <= 65535)) {
        return new Response("rows must be 16 integers 0–65535", { status: 400, headers: cors });
      }
      await panel.setCustom(rows);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    // --- Image library: the device fetches the bitmap for the id from /state ---
    // Same format as /custom: 16 newline-separated uint16 rows, MSB = leftmost pixel.
    const m = url.pathname.match(/^\/img\/(\d+)$/);
    if (m && request.method === "GET") {
      const id = Number(m[1]);
      const rows = id === CUSTOM_IMG ? await panel.getCustom() : IMAGES[id];
      if (!rows) return new Response("not found", { status: 404, headers: cors });
      return new Response(rows.join("\n"), {
        // Library images never change; the drawing (12) does.
        headers: { "Content-Type": "text/plain", "Cache-Control": id === CUSTOM_IMG ? "no-store" : "public, max-age=3600", ...cors },
      });
    }

    return new Response("not found", { status: 404, headers: cors });
  },
};


