export const DRAW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obegränsad Pixel Editor</title>
<style>
  :root { --bg:#0e1116; --card:#171c24; --line:#262e3a; --txt:#e6edf3;
          --muted:#8b97a7; --accent:#ffd23f; --on:#ffd23f; --off:#1b2230; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--txt); min-height:100vh;
         display:flex; flex-direction:column; align-items:center; padding:24px 16px; }
  h1 { font-size:20px; font-weight:600; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 20px; font-size:14px; text-align:center; }

  /* The panel shows pixels ~2x taller than wide, so each cell is stretched
     vertically to preview accurately. Grid is 16 wide; cell 22px x 40px. */
  /* Square pixels. Vertical gap is ~one extra pixel-height of dead space,
     matching the panel's real row spacing. */
  #panel { display:grid;
           grid-template-columns:repeat(16, 24px);
           grid-template-rows:repeat(16, 24px);
           column-gap:4px;
           row-gap:26px;
           background:#000; padding:10px;
           border-radius:12px; border:1px solid var(--line);
           touch-action:none; user-select:none; }
  .px { background:var(--off); border-radius:3px; cursor:crosshair; }
  .px.on { background:var(--on); box-shadow:0 0 6px var(--accent); }

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
  <h1>Pixel Editor · 16×16</h1>
  <p class="sub">Click or drag to paint · drag from a lit pixel to erase<br>
     Cells are stretched ~2× tall to match the panel's real geometry</p>

  <div id="panel"></div>

  <div class="bar">
    <button id="clear">Clear</button>
    <button id="invert">Invert</button>
    <button id="copy">Copy C array</button>
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
      const t = b.textContent; b.textContent = "Copied ✓";
      setTimeout(() => b.textContent = t, 1200);
    });
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
