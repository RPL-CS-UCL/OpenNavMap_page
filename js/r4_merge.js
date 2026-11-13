"use strict";
// P05 three-phase merge view (new piece in its own frame -> find matches -> optimise poses)
// and the Orders panel (p05b). Loaded after site.js; registers players in window.ONM_PLAYERS.
(function () {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const players = window.ONM_PLAYERS || {};
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(html);
  const tok = (n) => css.getPropertyValue("--" + n).trim();
  const C = { text: tok("text"), island: tok("island"), green: tok("accent"), ink: tok("accent-ink"), stage: tok("stage"),
    surface: tok("surface"), dim: tok("dim"), muted: tok("muted-fg"), rule: tok("rule"), grey: tok("gray-2") };
  const RED = "#E43527"; // correspondences and loop edges (no red token in the palette)
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt2 = (v) => (Math.round(v * 100 + 1e-6) / 100).toFixed(2);
  const pad2 = (n) => String(n).padStart(2, "0");
  const b64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
  const isTalk = () => html.dataset.mode === "present" || html.dataset.mode === "speaker";

  // ======================= P05 =======================
  const FEATURED = [5, 12, 3, 38]; // merge steps walked through by present-mode panel steps 1-4; step 5 plays the whole run
  const FAST = [100, 140, 220, 0], SLOW = [1400, 2000, 2400, 700]; // ms per phase: new piece, matches, optimise, hold
  const BOX = [96, 216, 1384, 906]; // map area on the 1920x1080 stage
  const INSET = [1404, 452, 1824, 712]; // own-frame inset (matches the .p05-inset box)
  const PAD = 0.04, MIN_VIEW_M = 60, BREAK_M = 30, OLD_ALPHA = 0.42;
  const SCALE_BAR_M = [20, 50, 100, 200], SCALE_BAR_PX = 130;
  // submaps with no link to the main map yet are drawn in a tray in the lower-left corner of the map area
  const TRAY = { x: BOX[0] + 6, y: BOX[1] + 30, w: 320, h: 130, pad: 10, gap: 24 }; // top-left corner of the map area (free in the final map)
  const TRAY_LABEL = "not linked yet", TRAY_FONT = '500 15px "JetBrains Mono", monospace';

  function initP05() {
    const M = window.ONM_MERGE, P = window.ONM_PROC, cv = document.getElementById("p05-canvas");
    if (!M || !P || !cv) return;
    const panel = document.getElementById("p05"), inner = panel.querySelector(".stage-inner");
    const ctx = cv.getContext("2d");
    const q = M.q, xy = new Int16Array(b64(M.xy)), last = M.steps.length - 1;
    const off = []; let a = 0; M.steps.forEach((s) => { off.push(a); a += s.n; });
    const proc = M.steps.map((s, k) => {
      const p = P.steps.find((x) => x.step === k + 1);
      if (p && p.piece !== s.piece) console.warn("p05: piece mismatch at step", k + 1);
      return p || null;
    });
    // node i of step k, metres
    const mx = (k, i) => xy[2 * (off[k] + i)] / q, my = (k, i) => xy[2 * (off[k] + i) + 1] / q;

    // node flags per step: 1 = outside the main component (steps[].unl = half-open node ranges)
    const flags = M.steps.map((s) => { const f = new Uint8Array(s.n); s.unl.forEach(([a, b]) => f.fill(1, a, b)); return f; });
    const nUnlRuns = (k) => { let i = 0, c = 0; M.steps[k].runs.forEach(([, n]) => { c += flags[k][i]; i += n; }); return c; };
    const trayBoxes = M.steps.map((s, k) => s.unl.map(([a, b]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = a; i < b; i++) {
        const x = mx(k, i), y = my(k, i);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { a, b, x0, y0, w: x1 - x0, h: y1 - y0 };
    }));
    // tray layout of step k: components side by side, top aligned, each fitted to its share of the tray width
    // (never drawn larger than the map scale)
    function trayOf(k, sc) {
      const bx = trayBoxes[k];
      if (!bx.length) return null;
      const share = (TRAY.w - (bx.length - 1) * TRAY.gap) / bx.length - 2 * TRAY.pad;
      let cur = TRAY.x;
      const comps = bx.map((c) => {
        const ts = Math.min(sc, share / Math.max(c.w, 1), (TRAY.h - 2 * TRAY.pad) / Math.max(c.h, 1));
        const bw = 2 * TRAY.pad + c.w * ts, bh = 2 * TRAY.pad + c.h * ts, o = { ...c, ts, bx: cur, by: TRAY.y, bw, bh };
        cur += bw + TRAY.gap;
        return o;
      });
      return { comps };
    }
    const trayX = (c, x) => c.bx + TRAY.pad + c.ts * (x - c.x0), trayY = (c, y) => c.by + c.bh - TRAY.pad - c.ts * (y - c.y0);
    const trayComp = (tr, i) => tr.comps.find((c) => i >= c.a && i < c.b);

    // camera per step: fits everything merged so far, never zooms back in
    const bw = BOX[2] - BOX[0], bh = BOX[3] - BOX[1], bcx = (BOX[0] + BOX[2]) / 2, bcy = (BOX[1] + BOX[3]) / 2;
    const cams = (() => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sc = Infinity;
      return M.steps.map((s, k) => {
        for (let i = 0; i < s.n; i++) {
          if (flags[k][i]) continue;
          const x = mx(k, i), y = my(k, i);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        const w = Math.max(x1 - x0, MIN_VIEW_M), h = Math.max(y1 - y0, MIN_VIEW_M);
        sc = Math.min(sc, bw / (w * (1 + 2 * PAD)), bh / (h * (1 + 2 * PAD)));
        return { sc, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
      });
    })();

    // per step: own-frame geometry for the inset and the rigid own->map motion (display only)
    const geo = proc.map((p, k) => {
      if (!p) return null;
      const n0 = k > 0 ? M.steps[k - 1].n : 0, n = M.steps[k].n - n0;
      const o = new Float32Array(2 * n);
      for (let i = 0; i < 2 * n; i++) o[i] = p.own[i] / P.q;
      let cmx = 0, cmy = 0;
      for (let i = 0; i < n; i++) { cmx += mx(k, n0 + i); cmy += my(k, n0 + i); }
      cmx /= n; cmy /= n;
      const th = p.rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      const r = new Float32Array(2 * n);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const ox = o[2 * i], oy = o[2 * i + 1];
        r[2 * i] = mx(k, n0 + i) - cmx - (c * ox - s * oy);
        r[2 * i + 1] = my(k, n0 + i) - cmy - (s * ox + c * oy);
        if (ox < x0) x0 = ox; if (ox > x1) x1 = ox; if (oy < y0) y0 = oy; if (oy > y1) y1 = oy;
      }
      const iw = INSET[2] - INSET[0] - 60, ih = INSET[3] - INSET[1] - 76;
      const sIn = Math.min(iw / Math.max(x1 - x0, 1), ih / Math.max(y1 - y0, 1), 12);
      const icx = (INSET[0] + INSET[2]) / 2 - sIn * (x0 + x1) / 2, icy = (INSET[1] + 24 + INSET[3]) / 2 + sIn * (y0 + y1) / 2;
      return { n0, n, o, r, cmx, cmy, th, sIn, icx, icy };
    });

    const el = (id) => document.getElementById(id);
    const chips = [...panel.querySelectorAll(".p05-chip")];
    const chip2 = el("p05-chip2-txt"), ncorr = el("p05-ncorr"), pair = el("p05-pair");
    const pairNew = el("p05-pair-new"), pairMap = el("p05-pair-map");
    const pieceEl = el("p05-piece"), rmsEl = el("p05-rms");
    const bar = el("p05-scalebar-line"), barLabel = el("p05-scalebar-m");
    const frames = [...panel.querySelectorAll(".p05-frame")], stripLabel = el("p05-strip-label");
    const slider = el("p05-slider"), readout = el("p05-readout"), toggle = el("p05-toggle");
    frames.forEach((f) => { f.style.backgroundImage = `url("${M.strip.src}")`; });
    const atlas = new Image(); atlas.src = M.strip.src;

    let cam = cams[last];
    const PX = (x) => bcx + cam.sc * (x - cam.cx), PY = (y) => bcy - cam.sc * (y - cam.cy);
    const brk2 = BREAK_M * BREAK_M;

    function polyline(pts, count) {
      for (let i = 0; i < count; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1];
        if (i === 0) { ctx.moveTo(x, y); continue; }
        const dx = (x - pts[2 * i - 2]) / cam.sc, dy = (y - pts[2 * i - 1]) / cam.sc;
        if (dx * dx + dy * dy > brk2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }

    let stripRow = -1, perm = [];
    function setStrip(k) {
      if (stripRow === k) return;
      stripRow = k;
      const s = M.steps[k], n0 = k > 0 ? M.steps[k - 1].n : 0, lab = s.label;
      stripLabel.textContent = "submap " + pad2(k + 1) + lab.slice(lab.indexOf(" ·")).replace(/ · \d+ m$/, "");
      perm = s.strip.map((o, j) => j).sort((u, v) => mx(k, n0 + s.strip[u]) - mx(k, n0 + s.strip[v]));
      frames.forEach((f, j) => {
        f.style.backgroundPosition = `${(100 * perm[j] / (M.strip.n - 1)).toFixed(3)}% ${(100 * k / last).toFixed(4)}%`;
        f.dataset.row = k;
      });
    }

    let lastUi = "";
    function setUi(k, ph, result) {
      const key = [k, ph, result].join();
      if (key === lastUi) return;
      lastUi = key;
      const p = proc[k], s = M.steps[k], prev = k > 0 ? M.steps[k - 1] : null;
      inner.classList.toggle("p05-proc", !result);
      pieceEl.textContent = pad2(k + 1);
      rmsEl.textContent = fmt2(s.ate);
      chips.forEach((c, i) => {
        c.classList.toggle("on", !!p && i === ph);
        c.classList.toggle("done", !p || i < ph);
      });
      const none = p && p.n_corr === 0 && p.n_loops === 0;
      chip2.textContent = none && ph >= 1 ? "No loop edge yet" : "Visual localization";
      let txt = "";
      const nu = nUnlRuns(k), more = nu ? " · " + nu + " submap" + (nu > 1 ? "s" : "") + " not linked yet" : "";
      if (p && result) txt = p.pair ? "step " + pad2(k + 1) + " · " + p.n_corr + (p.n_corr === 1 ? " correspondence" : " correspondences") + more : "";
      else if (p && ph >= 1) {
        if (none) txt = "disconnected submap";
        else if (p.n_corr === 0) txt = p.n_loops + " loop edge · node culled later";
        else txt = p.n_corr + (p.n_corr === 1 ? " correspondence" : " correspondences") + (ph >= 2 ? more : "");
      } else if (!p) txt = "initial submap";
      ncorr.textContent = txt; ncorr.classList.toggle("long", txt.length > 32);
      const showPair = !!(p && p.pair && (ph >= 1 || result));
      pair.classList.toggle("off", !showPair);
      if (showPair && pairNew.dataset.k !== String(k)) {
        pairNew.src = p.pair.new; pairMap.src = p.pair.map; pairNew.dataset.k = String(k);
      }
      if (slider) slider.value = String(k + 1);
      if (readout) readout.textContent = "Step " + pad2(k + 1) + " / " + (last + 1);
      setStrip(k);
    }

    // ph: 0 new piece, 1 matches, 2 optimise; t in [0, 1] within the phase. result: final look, no process overlay
    let dbg = null;
    function draw(k, ph, t, result) {
      dbg = null;
      const s = M.steps[k], prev = k > 0 ? M.steps[k - 1] : null, g = result ? null : geo[k], p = proc[k];
      const e3 = result || !g ? 1 : ph === 2 ? easeIO(t) : 0;
      const ca = cams[Math.max(0, k - 1)], cb = cams[k];
      cam = g ? { sc: lerp(ca.sc, cb.sc, e3), cx: lerp(ca.cx, cb.cx, e3), cy: lerp(ca.cy, cb.cy, e3) } : cb;
      setUi(k, result ? 2 : ph, result);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      // nodes already in the map: step k-1 -> step k positions
      const n0 = g ? g.n0 : s.n, runs = g ? prev.runs : s.runs;
      const fb = flags[k], fa = g ? flags[k - 1] : fb, flr = g && e3 < 0.95 ? fa : fb;
      const trB = trayOf(k, cam.sc), trA = g ? trayOf(k - 1, cam.sc) : trB;
      const pts = new Float32Array(2 * s.n);
      for (let i = 0; i < n0; i++) { // old nodes: screen position at step k-1 -> step k (main map or tray)
        let ax, ay, bx, by;
        if (fa[i]) { const c = trayComp(trA, i); ax = trayX(c, mx(k - 1, i)); ay = trayY(c, my(k - 1, i)); }
        else { ax = PX(g ? mx(k - 1, i) : mx(k, i)); ay = PY(g ? my(k - 1, i) : my(k, i)); }
        if (fb[i]) { const c = trayComp(trB, i); bx = trayX(c, mx(k, i)); by = trayY(c, my(k, i)); }
        else { bx = PX(mx(k, i)); by = PY(my(k, i)); }
        pts[2 * i] = lerp(ax, bx, e3); pts[2 * i + 1] = lerp(ay, by, e3);
      }
      const grey = new Path2D(), blue = new Path2D();
      let i0 = 0;
      runs.forEach(([, c], r) => {
        const path = flr[i0] ? blue : grey; // blue = not linked to the main map yet (drawn in the tray)
        for (let i = i0; i < i0 + c; i++) {
          const x = pts[2 * i], y = pts[2 * i + 1];
          if (i === i0) { path.moveTo(x, y); continue; }
          const dx = (x - pts[2 * i - 2]) / cam.sc, dy = (y - pts[2 * i - 1]) / cam.sc;
          if (dx * dx + dy * dy > brk2) path.moveTo(x, y); else path.lineTo(x, y);
        }
        i0 += c;
      });
      ctx.globalAlpha = OLD_ALPHA; ctx.strokeStyle = C.text; ctx.lineWidth = 2.5; ctx.stroke(grey);
      ctx.globalAlpha = 0.8; ctx.strokeStyle = C.island; ctx.lineWidth = 3; ctx.stroke(blue);
      ctx.globalAlpha = 1;
      const trShow = e3 < 0.5 ? trA : trB;
      if (trShow) drawTray(trShow);
      if (!g) { ctx.restore(); drawStripLeaders(k, pts, s.n - (k > 0 ? M.steps[k - 1].n : 0), k > 0 ? M.steps[k - 1].n : 0); return; }
      // the new piece: own frame (inset) -> map
      const th = g.th * e3, c = Math.cos(th), sn = Math.sin(th);
      const newBlk = !!fb[g.n0], tc = newBlk ? trayComp(trB, g.n0) : null; // new piece not linked: it ends in the tray
      const tX = (x) => (tc ? trayX(tc, x) : PX(x)), tY = (y) => (tc ? trayY(tc, y) : PY(y));
      const cX = lerp(g.icx, tX(g.cmx), e3), cY = lerp(g.icy, tY(g.cmy), e3);
      const sc = g.sIn * Math.pow((tc ? tc.ts : cam.sc) / g.sIn, e3);
      const np = new Float32Array(2 * g.n);
      for (let i = 0; i < g.n; i++) {
        const ox = g.o[2 * i], oy = g.o[2 * i + 1];
        const vx = c * ox - sn * oy + e3 * g.r[2 * i], vy = sn * ox + c * oy + e3 * g.r[2 * i + 1];
        np[2 * i] = cX + sc * vx; np[2 * i + 1] = cY - sc * vy;
        pts[2 * (g.n0 + i)] = np[2 * i]; pts[2 * (g.n0 + i) + 1] = np[2 * i + 1];
      }
      const done = ph === 2 && t >= 1;
      // own-frame copy stays in the inset once the piece starts moving onto the map
      if (e3 > 0) {
        ctx.beginPath();
        for (let i = 0; i < g.n; i++) {
          const x = g.icx + g.sIn * g.o[2 * i], y = g.icy - g.sIn * g.o[2 * i + 1];
          if (i === 0) { ctx.moveTo(x, y); continue; }
          const dx = g.o[2 * i] - g.o[2 * i - 2], dy = g.o[2 * i + 1] - g.o[2 * i - 1];
          if (dx * dx + dy * dy > brk2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = 0.5; ctx.strokeStyle = C.green; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
      }
      // matches: red lines from the piece's photos to the map photos they matched
      if (ph >= 1 && p.corr.length) {
        const nl = p.corr.length / 2, shown = ph === 1 ? Math.max(1, Math.ceil(nl * ease(Math.min(1, t * 1.6)))) : nl;
        ctx.globalAlpha = ph === 2 ? 0.9 * (1 - e3 * 0.5) : 0.9;
        ctx.strokeStyle = RED; ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let j = 0; j < shown; j++) {
          const a1 = p.corr[2 * j], b1 = p.corr[2 * j + 1];
          ctx.moveTo(np[2 * a1], np[2 * a1 + 1]); ctx.lineTo(pts[2 * b1], pts[2 * b1 + 1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = RED;
        for (let j = 0; j < shown; j++) {
          const a1 = p.corr[2 * j], b1 = p.corr[2 * j + 1];
          ctx.beginPath(); ctx.arc(np[2 * a1], np[2 * a1 + 1], 5, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(pts[2 * b1], pts[2 * b1 + 1], 5, 0, 2 * Math.PI); ctx.fill();
        }
      }
      ctx.beginPath(); polyline(np, g.n);
      ctx.globalAlpha = done && newBlk ? 0.8 : 1;
      ctx.strokeStyle = done && newBlk ? C.island : C.green; ctx.lineWidth = done && newBlk ? 3 : 4.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      let err = 0; // for the checks: distance (px) of the drawn piece from its stored map position
      for (let i = 0; i < g.n; i++) err = Math.max(err, Math.hypot(np[2 * i] - tX(mx(k, g.n0 + i)), np[2 * i + 1] - tY(my(k, g.n0 + i))));
      dbg = { k, ph, t, e3, lines: ph >= 1 ? p.corr.length / 2 : 0, err_px: +err.toFixed(2) };
      drawStripLeaders(k, pts, g.n, g.n0, !newBlk && (result || ph < 1 && !proc[k] || ph === 2 && t >= 0.9));
    }

    function drawTray(tr) {
      ctx.save();
      ctx.font = TRAY_FONT; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
      tr.comps.forEach((c) => {
        ctx.globalAlpha = 0.5; ctx.fillStyle = C.surface; ctx.fillRect(c.bx, c.by, c.bw, c.bh);
        ctx.globalAlpha = 0.9; ctx.strokeStyle = C.island; ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.strokeRect(c.bx, c.by, c.bw, c.bh);
      });
      ctx.setLineDash([]); ctx.fillStyle = C.muted; ctx.globalAlpha = 1; ctx.fillText(TRAY_LABEL, tr.comps[0].bx, TRAY.y - 5);
      ctx.restore();
    }

    function drawStripLeaders(k, pts, n, n0, vis) {
      const s = M.steps[k], narrow = !!frames[0].closest(".narrow");
      ctx.save();
      ctx.strokeStyle = C.dim; ctx.fillStyle = C.dim; ctx.lineWidth = 1.5;
      frames.forEach((f, j) => {
        const o = s.strip[perm[j]];
        if (!vis || o >= n || (narrow && f.dataset.narrow === "hide")) return;
        const nx = pts[2 * (n0 + o)], ny = pts[2 * (n0 + o) + 1], fx = f.offsetLeft + f.offsetWidth / 2, fy = f.offsetTop;
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(nx, ny, 4, 0, 2 * Math.PI); ctx.fill();
      });
      ctx.restore();
      const m = [...SCALE_BAR_M].reverse().find((v) => v * cam.sc <= SCALE_BAR_PX) || SCALE_BAR_M[0];
      bar.style.width = (m * cam.sc).toFixed(1) + "px";
      if (barLabel.textContent !== String(m)) barLabel.textContent = String(m);
    }

    // ---------- player ----------
    let k = last, ph = 2, t0 = 0, raf = 0, mode = "idle", fastAll = false, atEnd = true;
    const dur = (kk) => (kk === 0 ? [0, 0, 300, 0] : mode === "single" || (!fastAll && FEATURED.includes(kk + 1)) ? SLOW : FAST);
    function frame(now) {
      const d = dur(k), elT = now - t0;
      if (elT < d[ph] || (ph === 3 && elT < d[3])) {
        draw(k, Math.min(ph, 2), ph === 3 ? 1 : elT / d[ph], false);
      } else if (ph < 3) {
        ph++; t0 = now; draw(k, Math.min(ph, 2), ph === 3 ? 1 : 0, false);
      } else if (mode === "run" && k < last) {
        k++; ph = 0; t0 = now; draw(k, 0, 0, false);
      } else {
        if (mode === "run") { atEnd = true; draw(k, 2, 1, true); } else draw(k, 2, 1, false);
        stop(); return;
      }
      raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; api.playing = false; mode = mode === "run" && !atEnd ? "run" : mode; label(); }
    function start(m, kk, fast) {
      cancelAnimationFrame(raf);
      mode = m; k = kk; ph = 0; fastAll = !!fast; atEnd = false; t0 = performance.now();
      if (reduced) { draw(k, 2, 1, false); if (m === "run") { k = last; atEnd = true; draw(k, 2, 1, true); } api.playing = false; label(); return; }
      api.playing = true; raf = requestAnimationFrame(frame); label();
    }
    function label() {
      if (!toggle) return;
      toggle.textContent = api.playing ? "Pause" : "Play";
      toggle.setAttribute("aria-pressed", String(api.playing));
    }
    let userPaused = reduced;
    const api = {
      playing: false,
      atlas,
      // n = merge step index; phase 1-3 shows the process view at the end of that phase (t within it); no phase = finished step
      show(n, t = 1, phase) {
        cancelAnimationFrame(raf); raf = 0; api.playing = false; mode = "idle";
        k = Math.max(0, Math.min(last, n));
        if (phase) { ph = phase - 1; draw(k, ph, t, false); atEnd = false; } else if (k === last) { ph = 2; atEnd = true; draw(k, 2, 1, true); } else { ph = 2; atEnd = false; draw(k, 2, 1, false); }
        label();
      },
      redraw() { if (!api.playing) { if (atEnd) draw(k, 2, 1, true); else draw(k, Math.min(ph, 2), 1, false); } },
      play() {
        if (raf) return;
        if (mode === "run" && !atEnd) { api.playing = true; t0 = performance.now(); raf = requestAnimationFrame(frame); label(); }
        else start("run", atEnd ? 0 : k, false);
      },
      pause() { cancelAnimationFrame(raf); raf = 0; api.playing = false; label(); },
      replay() { if (isTalk()) panelStep(); else start("run", 0, false); },
      playStep(n) { start("single", Math.max(0, Math.min(last, n)), false); },
      label,
      auto(on) {
        if (on && !userPaused) { if (!api.playing && !(atEnd && mode !== "idle")) api.play(); } else if (!on) api.pause();
      },
    };
    // present mode: panel steps 1-4 walk through the featured merges, step 5 plays the whole run quickly
    function panelStep() {
      const n = Number(panel.dataset.stepNow || 1);
      if (n <= FEATURED.length) api.playStep(FEATURED[n - 1] - 1); else start("run", 0, true);
    }
    new MutationObserver(() => { if (isTalk() && html.dataset.current === "p05") panelStep(); })
      .observe(panel, { attributes: true, attributeFilter: ["data-step-now"] });
    atlas.onload = () => api.redraw();

    if (toggle) toggle.addEventListener("click", () => {
      if (api.playing) { api.pause(); userPaused = true; } else { userPaused = false; api.play(); }
    });
    const prevB = el("p05-prev"), nextB = el("p05-next");
    if (prevB) prevB.addEventListener("click", () => { userPaused = true; api.playStep((atEnd ? last + 1 : k) - 1); });
    if (nextB) nextB.addEventListener("click", () => { userPaused = true; api.playStep(atEnd ? 0 : k + 1); });
    // arrow keys on the Play / step buttons step through the merges (the slider handles its own arrows)
    const ctl = toggle && toggle.closest(".p05-ctl");
    if (ctl) ctl.addEventListener("keydown", (e) => {
      if (e.target === slider || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault(); (e.key === "ArrowLeft" ? prevB : nextB).click();
    });
    if (slider) {
      slider.max = String(last + 1);
      slider.addEventListener("input", () => { userPaused = true; api.show(Number(slider.value) - 1, 1, 3); });
      slider.addEventListener("change", () => { userPaused = true; api.playStep(Number(slider.value) - 1); });
    }
    Object.defineProperty(api, "debug", { get: () => dbg });
    players.p05 = api;
    api.show(last);

    const cap = params.get("capture");
    if (cap === "p05") {
      const f = Math.max(1, Math.min(last + 1, Number(params.get("frame")) || last + 1));
      const phase = Number(params.get("phase")) || 0;
      api.show(f - 1, Math.max(0, Math.min(1, Number(params.get("t") || 1))), phase >= 1 && phase <= 3 ? phase : undefined);
    } else if (isTalk() && html.dataset.current === "p05") {
      panelStep();
    } else if (html.dataset.mode === "scroll" && "IntersectionObserver" in window && !reduced) {
      new IntersectionObserver((en) => en.forEach((e) => {
        if (html.dataset.mode === "scroll") api.auto(e.intersectionRatio >= 0.5);
      }), { threshold: [0, 0.5] }).observe(cv);
    }
  }

  // ======================= Orders (p05b) =======================
  // nine shuffled merge orders, played in step: merged map grey, the piece added at this step green, its links red
  const ORD_STEP_MS = 260, ORD_HOLD_MS = 1500, ORD_BREAK_M = 30;
  function initOrders() {
    const O = window.ONM_ORDERS, cv = document.getElementById("p05b-canvas");
    if (!O || !cv) return;
    const panel = document.getElementById("p05b"), ctx = cv.getContext("2d");
    const cells = [...panel.querySelectorAll(".ord-cell")];
    const last = O.orders[0].n.length - 1, el = (id) => document.getElementById(id);
    const stepEl = el("p05b-step"), slider = el("p05b-slider"), readout = el("p05b-readout"), toggle = el("p05b-toggle");
    const R = O.orders.map((o) => {
      const xy = new Int16Array(b64(o.xy)), off = []; let a = 0;
      o.n.forEach((c) => { off.push(a); a += c; });
      const arr = new Uint8Array(o.n[last]);
      for (let k = last; k >= 0; k--) arr.fill(k, 0, o.n[k]);
      const exy = new Int16Array(b64(o.exy)), eoff = []; let e = 0;
      o.ne.forEach((c) => { eoff.push(e); e += c; });
      return { xy, off, n: o.n, arr, exy, eoff, ne: o.ne };
    });
    // one frame for all nine maps: the bounding box of the final maps
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    R.forEach((r) => { for (let i = 0; i < r.n[last]; i++) {
      const x = r.xy[2 * (r.off[last] + i)], y = r.xy[2 * (r.off[last] + i) + 1];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
    const padU = 0.03 * Math.max(x1 - x0, y1 - y0); x0 -= padU; x1 += padU; y0 -= padU; y1 += padU;
    // cell boxes need a laid-out panel: a chapter tab that is not shown yet is measured when it is first drawn visible
    let boxes = [], sc = 0;
    const measure = () => {
      boxes = cells.map((c) => [c.offsetLeft + 10, c.offsetTop + 46, c.offsetWidth - 20, c.offsetHeight - 56]);
      sc = Math.min(...boxes.map((b) => Math.min(b[2] / (x1 - x0), b[3] / (y1 - y0))));
      return sc > 0;
    };
    measure();
    const brk2 = Math.pow(ORD_BREAK_M / O.q, 2);
    let k = last, t0 = 0, raf = 0, playing = false, userPaused = false;

    function draw(kk) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      if (sc > 0 || measure()) R.forEach((r, o) => {
        const b = boxes[o]; if (!b) return;
        const cx = b[0] + b[2] / 2 - sc * (x0 + x1) / 2, cy = b[1] + b[3] / 2 + sc * (y0 + y1) / 2;
        const old = new Path2D(), fresh = new Path2D(), links = new Path2D(), base = 2 * r.off[kk], n = r.n[kk];
        let px = 0, py = 0;
        for (let i = 0; i < n; i++) {
          const ux = r.xy[base + 2 * i], uy = r.xy[base + 2 * i + 1], x = cx + sc * ux, y = cy - sc * uy;
          const ar = r.arr[i], path = ar === kk && kk > 0 ? fresh : old;
          const cont = i > 0 && r.arr[i - 1] === ar && (ux - px) * (ux - px) + (uy - py) * (uy - py) <= brk2;
          if (cont) path.lineTo(x, y); else { path.moveTo(x, y); path.lineTo(x + 0.01, y); }
          px = ux; py = uy;
        }
        ctx.save(); ctx.beginPath(); ctx.rect(b[0] - 6, b[1] - 6, b[2] + 12, b[3] + 12); ctx.clip();
        for (let j = 0, e0 = 4 * r.eoff[kk]; kk > 0 && j < r.ne[kk]; j++) {
          const q4 = e0 + 4 * j;
          links.moveTo(cx + sc * r.exy[q4], cy - sc * r.exy[q4 + 1]); links.lineTo(cx + sc * r.exy[q4 + 2], cy - sc * r.exy[q4 + 3]);
        }
        ctx.lineWidth = 2; ctx.strokeStyle = C.grey; ctx.stroke(old);
        ctx.lineWidth = 3.5; ctx.strokeStyle = C.green; ctx.stroke(fresh);
        ctx.lineWidth = 2.5; ctx.strokeStyle = RED; ctx.stroke(links);
        ctx.fillStyle = RED; // links are a few metres long, so mark both ends
        for (let j = 0, e0 = 4 * r.eoff[kk]; kk > 0 && j < r.ne[kk]; j++) for (const h of [0, 2]) {
          ctx.beginPath(); ctx.arc(cx + sc * r.exy[e0 + 4 * j + h], cy - sc * r.exy[e0 + 4 * j + h + 1], 3, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.restore();
      });
      if (stepEl) stepEl.textContent = pad2(kk + 1);
      if (slider) slider.value = String(kk + 1);
      if (readout) readout.textContent = "Step " + pad2(kk + 1) + " / " + (last + 1);
    }
    function label() {
      if (toggle) { toggle.textContent = playing ? "Pause" : "Play"; toggle.setAttribute("aria-pressed", String(playing)); }
    }
    function frame(now) {
      const el2 = now - t0, kk = Math.min(last, Math.floor(el2 / ORD_STEP_MS));
      if (kk !== k) { k = kk; draw(k); }
      if (el2 < (last + 1) * ORD_STEP_MS + ORD_HOLD_MS && k <= last && playing) raf = requestAnimationFrame(frame);
      else { playing = false; label(); }
    }
    const api = {
      get playing() { return playing; },
      show(n) { api.pause(); k = Math.max(0, Math.min(last, n)); draw(k); },
      redraw() { draw(k); },
      play() {
        if (k >= last) k = 0;
        cancelAnimationFrame(raf); playing = true; t0 = performance.now() - k * ORD_STEP_MS; draw(k); label();
        raf = requestAnimationFrame(frame);
      },
      pause() { cancelAnimationFrame(raf); playing = false; label(); },
      replay() { if (reduced) { api.show(last); return; } k = 0; api.play(); },
      label,
      auto(on) { if (on && !userPaused) { if (!playing && k < last) api.play(); } else if (!on) api.pause(); },
    };
    if (toggle) toggle.addEventListener("click", () => {
      if (playing) { api.pause(); userPaused = true; } else { userPaused = false; api.play(); }
    });
    const stepBy = (d) => { userPaused = true; api.show(k + d); };
    const prevB = el("p05b-prev"), nextB = el("p05b-next");
    if (prevB) prevB.addEventListener("click", () => stepBy(-1));
    if (nextB) nextB.addEventListener("click", () => stepBy(1));
    if (slider) {
      slider.max = String(last + 1);
      slider.addEventListener("input", () => { userPaused = true; api.show(Number(slider.value) - 1); });
    }
    players.p05b = api;
    if (params.get("capture") === "p05b") {
      api.show((Number(params.get("frame")) || last + 1) - 1);
    } else if (isTalk() && html.dataset.current === "p05b") {
      api.replay();
    } else {
      draw(last);
      if (html.dataset.mode === "scroll" && "IntersectionObserver" in window && !reduced) {
        let seen = false;
        new IntersectionObserver((en) => en.forEach((e) => {
          if (html.dataset.mode !== "scroll") return;
          if (e.intersectionRatio >= 0.5 && !seen && !userPaused) { seen = true; api.replay(); }
          else if (e.intersectionRatio < 0.5) api.pause();
        }), { threshold: [0, 0.5] }).observe(cv);
      }
    }
  }

  initP05();
  initOrders();
})();
