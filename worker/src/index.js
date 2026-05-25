// Obegränsad clock controller — Cloudflare Worker
//
// Routes:
//   GET  /        -> control webpage with buttons
//   POST /set     -> set the displayed image  body: {img: <int>, ttl: <seconds>}
//   GET  /state   -> device polls this; returns {img: <int>} honoring expiry
//
// Requires a KV namespace bound as CLOCK (see wrangler.toml).
// Optional: set a secret TOKEN to protect /set (Settings > Variables, or `wrangler secret put TOKEN`).

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

    return new Response("not found", { status: 404, headers: cors });
  },
};

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obegränsad Control</title>
<style>
  :root { --bg:#0e1116; --card:#171c24; --line:#262e3a; --txt:#e6edf3; --muted:#8b97a7; --accent:#ffd23f; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--txt); min-height:100vh;
         display:flex; flex-direction:column; align-items:center; padding:32px 16px; }
  h1 { font-size:20px; font-weight:600; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 24px; font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; width:100%; max-width:380px; }
  button { appearance:none; border:1px solid var(--line); background:var(--card); color:var(--txt);
           font-size:16px; padding:18px 12px; border-radius:14px; cursor:pointer;
           display:flex; flex-direction:column; align-items:center; gap:6px; transition:transform .06s, border-color .15s; }
  button:active { transform:scale(.96); }
  button:hover { border-color:var(--accent); }
  button .ico { font-size:26px; line-height:1; }
  button .lbl { font-size:13px; color:var(--muted); }
  .clock { grid-column:1 / -1; background:transparent; }
  #status { margin-top:20px; font-size:13px; color:var(--muted); min-height:18px; }
</style>
</head>
<body>
  <h1>Obegränsad Display</h1>
  <p class="sub">Tap to push to the clock · reverts after 60s</p>
  <div class="grid" id="grid"></div>
  <div id="status"></div>
<script>
  // image index -> label/icon. Matches your ESPHome globals:
  // 0=clock 1=test 2=smiley 3=heart 4=cloud 5=sun 6=lightning 7=battery 8=matrix 9=tetris
  const IMAGES = [
    { img:3, ico:"❤️", lbl:"Heart" },
    { img:2, ico:"🙂", lbl:"Smiley" },
    { img:5, ico:"☀️", lbl:"Sun" },
    { img:4, ico:"☁️", lbl:"Cloud" },
    { img:6, ico:"⚡", lbl:"Lightning" },
    { img:7, ico:"🔋", lbl:"Battery" },
    { img:8, ico:"🌧️", lbl:"Matrix" },
    { img:9, ico:"🟦", lbl:"Tetris" },
  ];
  const TTL = 60; // seconds
  const grid = document.getElementById("grid");
  const status = document.getElementById("status");

  IMAGES.forEach(item => {
    const b = document.createElement("button");
    b.innerHTML = '<span class="ico">'+item.ico+'</span><span class="lbl">'+item.lbl+'</span>';
    b.onclick = () => send(item.img, TTL, item.lbl);
    grid.appendChild(b);
  });
  // Persistent "back to clock" button.
  const clk = document.createElement("button");
  clk.className = "clock";
  clk.innerHTML = '<span class="lbl">↩ Back to clock now</span>';
  clk.onclick = () => send(0, 0, "Clock");
  grid.appendChild(clk);

  async function send(img, ttl, label) {
    status.textContent = "Sending " + label + "…";
    try {
      const r = await fetch("/set", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ img, ttl }),
      });
      if (!r.ok) throw new Error(r.status);
      status.textContent = label + " sent ✓" + (ttl>0 ? " (reverts in "+ttl+"s)" : "");
    } catch (e) {
      status.textContent = "Failed: " + e.message;
    }
  }
</script>
</body>
</html>`;
