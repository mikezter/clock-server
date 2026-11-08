export const DRAW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obegränsad Pixel Editor</title>
<style>
  :root { --bg:#0e1116; --card:#171c24; --line:#262e3a; --txt:#e6edf3;
          --muted:#8b97a7; --accent:#ffffff; --on:#ffffff; --off:#1b2230;
          /* Panel geometry in cell units, scaled from the real panel
             (pixel 0.5", h-gap 0.28125", v-gap 0.6875"):
             column-gap = 0.5625 cell, row-gap = 1.375 cell, padding = 0.5 cell.
             Total: width 16 + 15*0.5625 + 1 = 25.44 cells,
                    height 16 + 15*1.375 + 1 = 37.63 cells.
             The cell size is the largest that fits both the viewport width and
             the height left over for header + buttons, capped at 24px. */
          --chrome:150px;
          --cell:min(24px, calc((100vw - 34px) / 25.44), calc((100vh - var(--chrome)) / 37.63)); }
  @supports (height:100dvh) {
    :root { --cell:min(24px, calc((100vw - 34px) / 25.44), calc((100dvh - var(--chrome)) / 37.63)); }
  }
  * { box-sizing:border-box; }
  html, body { background:var(--bg); }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         color:var(--txt); min-height:100vh;
         display:flex; flex-direction:column; align-items:center; padding:12px 16px 24px; }
  h1 { font-size:17px; font-weight:600; margin:0 0 2px; }
  p.sub { color:var(--muted); margin:0 0 10px; font-size:12px; text-align:center; }

  #panel { display:grid;
           grid-template-columns:repeat(16, var(--cell));
           grid-template-rows:repeat(16, var(--cell));
           column-gap:calc(var(--cell) * 0.5625);
           row-gap:calc(var(--cell) * 1.375);
           padding:calc(var(--cell) * 0.5);
           background:#000;
           border-radius:10px; border:1px solid var(--line);
           touch-action:none; user-select:none; -webkit-user-select:none;
           -webkit-touch-callout:none; cursor:crosshair; }
  .px { background:var(--off); border-radius:2px; pointer-events:none; }
  .px.on { background:var(--on); box-shadow:0 0 calc(var(--cell) * 0.33) rgba(255,255,255,0.85); }

  .bar { display:flex; gap:8px; margin:10px 0 14px; justify-content:center;
         width:100%; max-width:560px; }
  button { appearance:none; border:1px solid var(--line); background:var(--card);
           color:var(--txt); font-size:14px; padding:10px 12px; border-radius:10px;
           cursor:pointer; touch-action:manipulation; flex:1 1 0; min-width:0;
           white-space:nowrap; }
  button:hover { border-color:var(--accent); }
  button.primary { background:var(--accent); color:#000; border-color:var(--accent);
                   font-weight:600; flex-grow:1.6; }
  button:disabled { opacity:.7; }

  details { width:100%; max-width:560px; }
  summary { color:var(--muted); font-size:13px; cursor:pointer; padding:6px 0; }
  #out { background:#0a0d12; border:1px solid var(--line);
         border-radius:10px; padding:14px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
         font-size:12px; color:#b9c4d4; white-space:pre; overflow-x:auto; margin-top:6px; }
  .hint { color:var(--muted); font-size:12px; margin-top:6px; }
  .bar.small button { font-size:13px; padding:8px 10px; }
</style>
</head>
<body>
  <h1>Pixel Editor · 16×16</h1>
  <p class="sub">Tap or drag to paint · start on a lit pixel to erase</p>

  <div id="panel"></div>

  <div class="bar">
    <button id="clear">Clear</button>
    <button id="invert">Invert</button>
    <button id="send" class="primary">Send to clock</button>
  </div>

  <details>
    <summary>C array</summary>
    <div id="out"></div>
    <div class="bar small"><button id="copy">Copy C array</button></div>
    <div class="hint">Paste this into <code>images.h</code> as a new <code>Image16x16</code>.</div>
  </details>

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
      panel.appendChild(d);
      cells.push(d);
    }
  }

  let painting = false;
  let paintValue = 1; // set on pointerdown: 1 if target was off (=> paint), 0 if on (=> erase)
  let last = null;    // last painted cell, for filling in fast strokes

  function setCell(r, c, v) {
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    grid[r][c] = v;
    cells[r * N + c].classList.toggle("on", v === 1);
  }

  // Map a pointer position to the NEAREST cell, so touches landing in the
  // (large) gaps between rows still count. Uses the centers of the first and
  // last cell, so it follows whatever size the CSS gave the panel.
  function cellFromEvent(e) {
    const a = cells[0].getBoundingClientRect();
    const b = cells[N * N - 1].getBoundingClientRect();
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const clamp = v => Math.max(0, Math.min(N - 1, v));
    return {
      r: clamp(Math.round((e.clientY - y0) / (y1 - y0) * (N - 1))),
      c: clamp(Math.round((e.clientX - x0) / (x1 - x0) * (N - 1))),
    };
  }

  // Paint every cell on the straight line from the last cell to p, so quick
  // finger strokes do not leave holes.
  function strokeTo(p) {
    const from = last || p;
    const steps = Math.max(Math.abs(p.r - from.r), Math.abs(p.c - from.c));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      setCell(Math.round(from.r + (p.r - from.r) * t),
              Math.round(from.c + (p.c - from.c) * t), paintValue);
    }
    last = p;
    render();
  }

  panel.addEventListener("pointerdown", e => {
    const p = cellFromEvent(e);
    painting = true;
    last = null;
    paintValue = grid[p.r][p.c] === 1 ? 0 : 1; // direction decided by first cell
    strokeTo(p);
    panel.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  panel.addEventListener("pointermove", e => {
    if (!painting) return;
    const p = cellFromEvent(e);
    if (last && p.r === last.r && p.c === last.c) return;
    strokeTo(p);
  });
  const stop = () => { painting = false; last = null; };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);

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
      const t = b.textContent; b.textContent = "Copied ✓";
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
    b.textContent = "Sending…"; b.disabled = true;
    try {
      const r = await fetch("/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      b.textContent = r.ok ? "Sent ✓" : "Error " + r.status;
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
</script>
</body>
</html>`;
