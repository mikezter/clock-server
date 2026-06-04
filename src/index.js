// Obegränsad clock controller — Cloudflare Worker
//
// Routes:
//   GET  /        -> control webpage with buttons
//   POST /set     -> set the displayed image  body: {img: <int>, ttl: <seconds>}
//   GET  /state   -> device polls this; returns {img: <int>} honoring expiry
//
// Requires a KV namespace bound as CLOCK (see wrangler.toml).
// Optional: set a secret TOKEN to protect /set (Settings > Variables, or `wrangler secret put TOKEN`).

import { DRAW_PAGE } from "./DRAW_PAGE";
import { PAGE } from "./PAGE";

const DEFAULT_IMG = 0;      // 0 = clock mode (what we revert to)
const DEFAULT_TTL = 60;     // seconds an image stays before reverting

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
      const raw = await env.CLOCK.get("state");
      let img = DEFAULT_IMG;
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.expiresAt || Date.now() < s.expiresAt) {
          img = s.img;
        }
        // else: expired -> fall through to DEFAULT_IMG (clock)
      }
      // Plain integer body keeps ESP8266 parsing trivial.
      return new Response(String(img), {
        headers: { "Content-Type": "text/plain", ...cors },
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
      const state = {
        img,
        // ttl <= 0 means "stay forever until changed"
        expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
      };
      await env.CLOCK.put("state", JSON.stringify(state));
      return new Response(JSON.stringify(state), {
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
      const raw = await env.CLOCK.get("custom_img");
      const rows = raw ? JSON.parse(raw) : new Array(16).fill(0);
      return new Response(rows.join("\n"), {
        headers: { "Content-Type": "text/plain", ...cors },
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
      await env.CLOCK.put("custom_img", JSON.stringify(rows));
      await env.CLOCK.put("state", JSON.stringify({ img: 12, expiresAt: null }));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    return new Response("not found", { status: 404, headers: cors });
  },
};


