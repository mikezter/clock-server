// src/DRAW_PAGE.js
var DRAW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obegr\xE4nsad Pixel Editor</title>
<style>
  :root { --bg:#0e1116; --card:#171c24; --line:#262e3a; --txt:#e6edf3;
          --muted:#8b97a7; --accent:#ffffff; --on:#ffffff; --off:#1b2230; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--txt); min-height:100vh;
         display:flex; flex-direction:column; align-items:center; padding:24px 16px; }
  h1 { font-size:20px; font-weight:600; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 20px; font-size:14px; text-align:center; }

  /* Geometry scaled from the real panel (pixel 0.5", h-gap 0.28125", v-gap 0.6875").
     At cell=24px: column-gap = 24*0.5625 \u2248 14px, row-gap = 24*1.375 = 33px.
     Reproduces the panel's ~27:40 rendering aspect ratio. */
  #panel { display:grid;
           grid-template-columns:repeat(16, 24px);
           grid-template-rows:repeat(16, 24px);
           column-gap:14px;
           row-gap:33px;
           background:#000; padding:14px;
           border-radius:12px; border:1px solid var(--line);
           touch-action:none; user-select:none; }
  .px { background:var(--off); border-radius:2px; cursor:crosshair; }
  .px.on { background:var(--on); box-shadow:0 0 8px rgba(255,255,255,0.85); }

  .bar { display:flex; gap:10px; margin:18px 0; flex-wrap:wrap; justify-content:center; }
  button { appearance:none; border:1px solid var(--line); background:var(--card);
           color:var(--txt); font-size:14px; padding:10px 16px; border-radius:10px;
           cursor:pointer; }
  button:hover { border-color:var(--accent); }

  #out { width:100%; max-width:560px; background:#0a0d12; border:1px solid var(--line);
         border-radius:10px; padding:14px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
         font-size:12px; color:#b9c4d4; white-space:pre; overflow-x:auto; }
  .hint { color:var(--muted); font-size:12px; margin-top:6px; }
</style>
</head>
<body>
  <h1>Pixel Editor \xB7 16\xD716</h1>
  <p class="sub">Click or drag to paint \xB7 drag from a lit pixel to erase<br>
     Spacing matches the real panel \u2014 wide vertical gaps between rows</p>

  <div id="panel"></div>

  <div class="bar">
    <button id="clear">Clear</button>
    <button id="invert">Invert</button>
    <button id="copy">Copy C array</button>
    <button id="send">Send to clock</button>
  </div>

  <div id="out"></div>
  <div class="hint">Paste this into <code>images.h</code> as a new <code>Image16x16</code>.</div>

<script>
  const N = 16;
  const panel = document.getElementById("panel");
  const out = document.getElementById("out");
  const grid = Array.from({length:N}, () => new Array(N).fill(0));
  const cells = [];

  // Build cells row-major (row 0 at top).
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const d = document.createElement("div");
      d.className = "px";
      d.dataset.r = r; d.dataset.c = c;
      panel.appendChild(d);
      cells.push(d);
    }
  }

  let painting = false;
  let paintValue = 1; // set on pointerdown: 1 if target was off (=> paint), 0 if on (=> erase)

  function setCell(r, c, v) {
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    grid[r][c] = v;
    const idx = r * N + c;
    cells[idx].classList.toggle("on", v === 1);
  }

  function cellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.classList.contains("px")) return null;
    return { r: +el.dataset.r, c: +el.dataset.c };
  }

  panel.addEventListener("pointerdown", e => {
    const p = cellFromEvent(e);
    if (!p) return;
    painting = true;
    paintValue = grid[p.r][p.c] === 1 ? 0 : 1; // toggle direction based on first cell
    setCell(p.r, p.c, paintValue);
    render();
    panel.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  panel.addEventListener("pointermove", e => {
    if (!painting) return;
    const p = cellFromEvent(e);
    if (!p) return;
    setCell(p.r, p.c, paintValue);
    render();
  });
  window.addEventListener("pointerup", () => { painting = false; });

  document.getElementById("clear").onclick = () => {
    for (let r=0;r<N;r++) for (let c=0;c<N;c++) setCell(r,c,0);
    render();
  };
  document.getElementById("invert").onclick = () => {
    for (let r=0;r<N;r++) for (let c=0;c<N;c++) setCell(r,c, grid[r][c]?0:1);
    render();
  };
  document.getElementById("copy").onclick = () => {
    navigator.clipboard.writeText(out.textContent).then(() => {
      const b = document.getElementById("copy");
      const t = b.textContent; b.textContent = "Copied \u2713";
      setTimeout(() => b.textContent = t, 1200);
    });
  };

  document.getElementById("send").onclick = async () => {
    const rows = grid.map(row => {
      let word = 0;
      for (let c = 0; c < N; c++) if (row[c]) word |= (1 << (15 - c));
      return word;
    });
    const b = document.getElementById("send");
    const t = b.textContent;
    b.textContent = "Sending\u2026"; b.disabled = true;
    try {
      const r = await fetch("/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      b.textContent = r.ok ? "Sent \u2713" : "Error " + r.status;
    } catch (e) {
      b.textContent = "Failed";
    }
    setTimeout(() => { b.textContent = t; b.disabled = false; }, 2000);
  };

  // Each row is a 16-bit value. Bit 15 = leftmost column (c=0), bit 0 = rightmost.
  // This matches a typical MSB-first row layout; flip if your draw_image expects LSB-first.
  function render() {
    let lines = ["Image16x16 IMG_CUSTOM = {"];
    for (let r=0;r<N;r++) {
      let word = 0;
      for (let c=0;c<N;c++) {
        if (grid[r][c]) word |= (1 << (15 - c));
      }
      const hex = "0x" + word.toString(16).toUpperCase().padStart(4,"0");
      lines.push("  " + hex + (r < N-1 ? "," : ""));
    }
    lines.push("};");
    out.textContent = lines.join("\\n");
  }

  render();
<\/script>
</body>
</html>`;

// src/PAGE.js
var PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obegr\xE4nsad Control</title>
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
  <h1>Obegr\xE4nsad Display</h1>
  <p class="sub">Tap to push to the clock \xB7 reverts after 60s</p>
  <div class="grid" id="grid"></div>
  <div id="status"></div>
<script>
  // image index -> label/icon. Matches your ESPHome globals:
  // 0=clock 1=test 2=smiley 3=heart 4=cloud 5=sun 6=lightning 7=battery 8=matrix 9=tetris
  const IMAGES = [
    { img:3, ico:"\u2764\uFE0F", lbl:"Heart" },
    { img:2, ico:"\u{1F642}", lbl:"Smiley" },
    { img:5, ico:"\u2600\uFE0F", lbl:"Sun" },
    { img:4, ico:"\u2601\uFE0F", lbl:"Cloud" },
    { img:6, ico:"\u26A1", lbl:"Lightning" },
    { img:7, ico:"\u{1F50B}", lbl:"Battery" },
    { img:8, ico:"\u{1F327}\uFE0F", lbl:"Matrix" },
    { img:9, ico:"\u{1F7E6}", lbl:"Tetris" },
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
  clk.innerHTML = '<span class="lbl">\u21A9 Back to clock now</span>';
  clk.onclick = () => send(0, 0, "Clock");
  grid.appendChild(clk);

  async function send(img, ttl, label) {
    status.textContent = "Sending " + label + "\u2026";
    try {
      const r = await fetch("/set", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ img, ttl }),
      });
      if (!r.ok) throw new Error(r.status);
      status.textContent = label + " sent \u2713" + (ttl>0 ? " (reverts in "+ttl+"s)" : "");
    } catch (e) {
      status.textContent = "Failed: " + e.message;
    }
  }
<\/script>
</body>
</html>`;

// src/index.js
var DEFAULT_IMG = 0;
var DEFAULT_TTL = 60;
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Token"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (url.pathname === "/state") {
      const raw = await env.CLOCK.get("state");
      let img = DEFAULT_IMG;
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.expiresAt || Date.now() < s.expiresAt) {
          img = s.img;
        }
      }
      return new Response(String(img), {
        headers: { "Content-Type": "text/plain", ...cors }
      });
    }
    if (url.pathname === "/set" && request.method === "POST") {
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
        expiresAt: ttl > 0 ? Date.now() + ttl * 1e3 : null
      };
      await env.CLOCK.put("state", JSON.stringify(state));
      return new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json", ...cors }
      });
    }
    if (url.pathname === "/") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (url.pathname === "/draw") {
      return new Response(DRAW_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (url.pathname === "/custom" && request.method === "GET") {
      const raw = await env.CLOCK.get("custom_img");
      const rows = raw ? JSON.parse(raw) : new Array(16).fill(0);
      return new Response(rows.join("\n"), {
        headers: { "Content-Type": "text/plain", ...cors }
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
      if (!Array.isArray(rows) || rows.length !== 16 || !rows.every((v) => Number.isInteger(v) && v >= 0 && v <= 65535)) {
        return new Response("rows must be 16 integers 0\u201365535", { status: 400, headers: cors });
      }
      await env.CLOCK.put("custom_img", JSON.stringify(rows));
      await env.CLOCK.put("state", JSON.stringify({ img: 12, expiresAt: null }));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...cors }
      });
    }
    return new Response("not found", { status: 404, headers: cors });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

