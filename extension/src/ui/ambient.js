// Ambient background: blurred accent orbs plus an interactive dot grid on a
// <canvas>. Dots near the cursor brighten and glow in the brand blue.

export function mountAmbient({ host = document.body, spacing = 22, radius = 140, orbs = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'ambient';
  wrap.setAttribute('aria-hidden', 'true');
  if (orbs) {
    wrap.innerHTML = `
      <div class="orb blue" style="width:520px;height:520px;top:-180px;right:-140px"></div>
      <div class="orb cream" style="width:460px;height:460px;bottom:-200px;left:-120px"></div>
      <div class="orb blue" style="width:300px;height:300px;top:45%;left:38%;opacity:.25;animation-duration:38s"></div>`;
  }
  const canvas = document.createElement('canvas');
  wrap.prepend(canvas);
  host.prepend(wrap);

  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
  let raf = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = wrap.clientWidth;
    h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const r2 = radius * radius;
    for (let y = spacing / 2; y < h; y += spacing) {
      for (let x = spacing / 2; x < w; x += spacing) {
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const k = 1 - Math.sqrt(d2) / radius;
          const ease = k * k;
          // pull the dot slightly toward the cursor
          const px = x - dx * ease * 0.12;
          const py = y - dy * ease * 0.12;
          ctx.beginPath();
          ctx.fillStyle = `rgba(76,155,234,${0.18 + ease * 0.75})`;
          ctx.shadowColor = 'rgba(44,132,219,0.9)';
          ctx.shadowBlur = 10 * ease;
          ctx.arc(px, py, 1 + ease * 1.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
          ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
        }
      }
    }
  }

  function tick() {
    mouse.x += (mouse.tx - mouse.x) * 0.18;
    mouse.y += (mouse.ty - mouse.y) * 0.18;
    draw();
    if (Math.abs(mouse.tx - mouse.x) > 0.5 || Math.abs(mouse.ty - mouse.y) > 0.5) raf = requestAnimationFrame(tick);
    else raf = 0;
  }

  function onMove(e) {
    const r = wrap.getBoundingClientRect();
    mouse.tx = e.clientX - r.left;
    mouse.ty = e.clientY - r.top;
    if (mouse.x < -1000) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
    if (reduce) { mouse.x = mouse.tx; mouse.y = mouse.ty; draw(); return; }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function onLeave() {
    mouse.tx = mouse.ty = -9999;
    mouse.x = mouse.y = -9999;
    draw();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  resize();
}
