export const PAGE = `<!doctype html>
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
