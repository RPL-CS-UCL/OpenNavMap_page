"use strict";

// Panel order = order of the .panel sections in index.html (a new section joins the page and the talk by itself).
// data-talk-only: shown in the talk only. data-talk-skip: unfinished, left out of the talk.
const ALL_PANELS = Array.from(document.querySelectorAll(".panel"));
const WEB_ORDER = ALL_PANELS.filter((p) => p.id !== "hook").map((p) => p.id);
const TALK_ORDER = ALL_PANELS.filter((p) => !p.hasAttribute("data-talk-skip")).map((p) => p.id);

const STAGE_W = 1920;
const MIN_STAGE_TEXT = 24; // smallest label inside a stage, in stage pixels
const MIN_SCREEN_TEXT = 12; // below this on screen, stage text is hidden and repeated as HTML
const PAD = 0.12; // p05 camera: margin around the merged extent, per side
const MIN_VIEW_M = 60; // p05 camera: never zoom closer than this extent
const SCALE_BAR_M = [20, 50, 100, 200]; // p05 scale bar: nice lengths; the longest that fits SCALE_BAR_PX is shown
const SCALE_BAR_PX = 300;
const BREAK_M = 30; // a piece's line is broken where consecutive photos are further apart than this
const STEP_MS = 350; // hero: one piece per step
const HOLD_MS = 2000;
// p05: the first pieces slowly (their photos are readable), then the rest quickly
const P05_SLOW_STEPS = 5, P05_SLOW_MS = 1800, P05_FAST_MS = 220;

(function () {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const panels = {};
  document.querySelectorAll(".panel").forEach((p) => { panels[p.id] = p; });
  const NS = "http://www.w3.org/2000/svg";
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nums = window.ONM_NUMBERS || {};
  // canvas and generated-SVG colours come from the :root tokens in css/site.css (one source of truth)
  const css = getComputedStyle(html);
  const tok = (n) => css.getPropertyValue("--" + n).trim();
  const C = { fg: tok("fg"), text: tok("text"), muted: tok("muted-fg"), dim: tok("dim"), gray1: tok("gray-1"), gray2: tok("gray-2"),
    green: tok("accent"), ink: tok("accent-ink"), stage: tok("stage"), surface: tok("surface"), border: tok("border"), rule: tok("rule"),
    island: tok("island") };
  const OLD_ALPHA = 0.42; // earlier pieces of the map: --text at reduced opacity

  let order = TALK_ORDER;
  let cur = 0;
  let step = 1;
  let talkStart = Date.now();
  let panelStart = Date.now();
  let speakerWin = null;

  // ---------- numbers: every number on the page comes from numbers.json via numbers.js ----------
  function fillNumbers() {
    document.querySelectorAll("[data-num]").forEach((el) => {
      const e = nums[el.dataset.num];
      if (!e) {
        el.textContent = "??";
        el.classList.add("num-missing");
        console.warn("missing number", el.dataset.num);
        return;
      }
      const d = el.dataset.digits;
      el.textContent = d !== undefined ? Number(e.value).toFixed(Number(d)) : e.text;
      el.title = e.source;
    });
  }

  // ---------- stage scaling ----------
  // scroll page: a panel's stage shows the 1920x1080 frame minus its crop (--cx each side, CSS); scale to the visible width
  function fit(stage) {
    const w = stage.clientWidth;
    if (!w) return;
    const panel = stage.closest(".panel");
    const cx = html.dataset.mode === "scroll" && !panel.classList.contains("cover")
      ? Number(getComputedStyle(stage).getPropertyValue("--cx")) || 0 : 0;
    const s = w / (STAGE_W - 2 * cx);
    stage.style.setProperty("--s", s);
    panel.style.setProperty("--s-px", s + "px");
    panel.classList.toggle("narrow", s * MIN_STAGE_TEXT < MIN_SCREEN_TEXT);
  }

  function initStages() {
    const stages = document.querySelectorAll(".stage");
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver((entries) => entries.forEach((en) => fit(en.target)));
      stages.forEach((s) => ro.observe(s));
    }
    const refit = () => stages.forEach(fit);
    window.addEventListener("resize", refit);
    refit();
  }

  // ---------- steps: elements with data-step="n" show once the panel reaches step n ----------
  function maxStep(panel) {
    if (panel.dataset.maxStep) return Number(panel.dataset.maxStep);
    let m = 1;
    panel.querySelectorAll("[data-step]").forEach((el) => { m = Math.max(m, Number(el.dataset.step)); });
    return m;
  }

  function setStep(panel, n) {
    panel.dataset.stepNow = String(n);
    panel.querySelectorAll("[data-step]").forEach((el) => {
      el.classList.toggle("step-hidden", Number(el.dataset.step) > n);
    });
    // p04 has no hidden parts: step n highlights block n; the scroll page starts with all blocks at full strength
    if (panel.id === "p04") p04Highlight(html.dataset.mode === "scroll" ? 0 : n);
    const row = chipRows[panel.id];
    if (row) row.chips.forEach((b, i) => b.setAttribute("aria-pressed", String(i + 1 === n)));
    panel.dispatchEvent(new CustomEvent("onm-step", { detail: n }));
  }

  // ---------- step chips: a panel with data-step-labels="a|b|c" gets one chip per step and a Play/Pause ----------
  // scroll page: a chip shows the figure up to its step and stops the auto-play; presenting: a chip jumps to that step
  const chipRows = {};
  const autoRun = {};
  function initStepChips() {
    document.querySelectorAll(".panel[data-step-labels]").forEach((p) => {
      const row = document.createElement("div");
      row.className = "step-row step-chips";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Steps");
      const chips = p.dataset.stepLabels.split("|").map((label, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "step-chip";
        b.title = label;
        b.setAttribute("aria-pressed", "false");
        b.innerHTML = `<span>${i + 1}</span><i></i>`;
        b.querySelector("i").textContent = label;
        b.addEventListener("click", () => {
          if (html.dataset.mode === "present" && order[cur] === p.id) { show(cur, i + 1); return; }
          stopAuto(p, true);
          setStep(p, i + 1);
        });
        row.appendChild(b);
        return b;
      });
      const play = document.createElement("button");
      play.type = "button";
      play.className = "step-btn step-play";
      play.textContent = "Play";
      play.addEventListener("click", () => {
        if (autoRun[p.id] && autoRun[p.id].timer) { stopAuto(p, true); return; }
        const now = Number(p.dataset.stepNow) || maxStep(p);
        runAuto(p, now >= maxStep(p) ? 1 : now + 1);
      });
      row.appendChild(play);
      p.querySelector(":scope > .stage").after(row);
      chipRows[p.id] = { chips, play };
    });
  }

  function stopAuto(p, byUser) {
    const a = autoRun[p.id] || (autoRun[p.id] = {});
    clearInterval(a.timer);
    a.timer = 0;
    if (byUser) a.user = true;
    if (chipRows[p.id]) chipRows[p.id].play.textContent = "Play";
  }

  function runAuto(p, from) {
    stopAuto(p, false);
    const a = autoRun[p.id];
    let n = from;
    setStep(p, n);
    if (n >= maxStep(p)) return;
    if (chipRows[p.id]) chipRows[p.id].play.textContent = "Pause";
    a.timer = setInterval(() => { n += 1; setStep(p, n); if (n >= maxStep(p)) stopAuto(p, false); }, Number(p.dataset.autoSteps) || 1500);
  }

// scroll page: panels with data-auto-steps replay their steps when they scroll into view
  function initAutoSteps() {
    if (html.dataset.mode !== "scroll" || !("IntersectionObserver" in window) || reduced) return;
    document.querySelectorAll(".panel[data-auto-steps]").forEach((p) => {
      new IntersectionObserver((en) => en.forEach((e) => {
        // a chip or Pause the reader pressed wins over the auto-play
        if (autoRun[p.id] && autoRun[p.id].user) return;
        if (!e.isIntersecting) { stopAuto(p, false); return; }
        runAuto(p, 1);
      }), { threshold: 0.5 }).observe(p);
    });
  }

    function p04Highlight(k) {
    const inner = document.getElementById("p04-inner");
    if (inner) inner.dataset.hl = String(k);
    document.querySelectorAll("[data-p04-step]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.p04Step) === k)));
  }

  const svgEl = (parent, tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    parent.appendChild(el);
    return el;
  };

  // ---------- P02: three schematics of what a map keeps, and the bar at true scale ----------
  function buildP02() {
    const path = Array.from({ length: 37 }, (_, i) => [20 + i * 10, 150 - 22 * Math.sin(i / 36 * Math.PI * 1.6)]);
    const cams = [2, 10, 18, 26, 34].map((i) => path[i]);
    const hash = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const line = (svg, stroke, w) => svgEl(svg, "path", { d: "M" + path.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join(" L"),
      fill: "none", stroke, "stroke-width": w, "stroke-linecap": "round" });
    const cam = (svg, [x, y]) => {
      svgEl(svg, "path", { d: `M${x} ${y} L${x - 10} ${y - 16} H${x + 10} Z`, fill: "none", stroke: C.fg, "stroke-width": 2, "stroke-linejoin": "round" });
      svgEl(svg, "circle", { cx: x, cy: y, r: 4, fill: C.fg });
    };
    const dense = document.getElementById("p02-dense");
    const landmark = document.getElementById("p02-landmark");
    const onm = document.getElementById("p02-onm");
    if (!dense || !landmark || !onm) return;
    for (let i = 0; i < 900; i++) {
      svgEl(dense, "circle", { cx: (8 + hash(i) * 384).toFixed(1), cy: (8 + hash(i + 7e3) * 174).toFixed(1), r: 1.6, fill: C.dim });
    }
    line(dense, C.gray2, 2);
    cams.forEach((c) => cam(dense, c));

    const pts = Array.from({ length: 16 }, (_, i) => [24 + i * 23 + hash(i + 50) * 12, 18 + hash(i + 90) * 60]);
    line(landmark, C.dim, 2);
    cams.forEach((c, j) => pts.forEach((p, i) => {
      if (Math.abs(p[0] - c[0]) < 70 && (i + j) % 2 === 0) {
        svgEl(landmark, "line", { x1: c[0], y1: c[1] - 16, x2: p[0].toFixed(1), y2: p[1].toFixed(1), stroke: C.dim, "stroke-width": 1.2 });
      }
    }));
    pts.forEach((p) => svgEl(landmark, "circle", { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 4, fill: C.gray1 }));
    cams.forEach((c) => cam(landmark, c));

    cams.forEach((c, i) => {
      if (i > 0) svgEl(onm, "line", { x1: cams[i - 1][0], y1: cams[i - 1][1], x2: c[0], y2: c[1], stroke: C.green, "stroke-width": 4 });
    });
    svgEl(onm, "path", { d: `M${cams[1][0]} ${cams[1][1]} Q${(cams[1][0] + cams[3][0]) / 2} ${cams[2][1] + 46} ${cams[3][0]} ${cams[3][1]}`,
      fill: "none", stroke: C.green, "stroke-width": 2, "stroke-dasharray": "8 6" });
    cams.forEach((c) => cam(onm, c));

    // storage bars to scale: the largest fills the 924 px row
    const bars = Array.from(document.querySelectorAll("#p02 [data-mb]"));
    const top = Math.max(...bars.map((el) => nums[el.dataset.mb].value));
    bars.forEach((el) => { el.style.width = (924 * nums[el.dataset.mb].value / top).toFixed(2) + "px"; });
  }

  // ---------- P03 left: real top-down trajectories of submaps 36 and 20 (merged map R2-4) ----------
  // Geometry from render/build_p03_map.py (data/p03_map.js): equal axes, rotated so south runs right,
  // clipped to a window around the match. Photos are nodes 28-30 and 1301-1303; 29 and 1302 are the
  // pair MASt3R measures on the right half.
  const P03_ROWS = { 36: { top: 336, when: "on 21 December", below: true }, 20: { top: 744, when: "on 4 December", below: false } };

  function buildP03() {
    const host = document.getElementById("p03-photos"), M = window.ONM_P03;
    if (!host || !M) return;
    const w = 290, h = 163, xs = [96, 403, 710], hl = 1;
    const g = (id) => document.getElementById(id);
    const [cx, cy, cw, ch] = M.clip;
    svgEl(svgEl(g("p03-walk"), "clipPath", { id: "p03-clip" }), "rect", { x: cx, y: cy, width: cw, height: ch });
    M.walks.forEach((walk) => {
      const row = P03_ROWS[walk.id];
      svgEl(g("p03-lines"), "path", { d: "M" + walk.pts.map((p) => p.join(" ")).join(" L"), class: "p03-w" + walk.id });
      walk.pts.forEach(([x, y]) => svgEl(g("p03-trk"), "circle", { cx: x, cy: y, r: 4 }));
      walk.photos.forEach((ph, i) => {
        const [x, y] = ph.p, px = xs[i] + w / 2;
        const img = document.createElement("img");
        img.src = `media/stills/photos/p03_s_${String(ph.f).padStart(6, "0")}.jpg`;
        img.alt = `Photo ${i + 1} of 3 along submap ${walk.id}, recorded ${row.when}` + (i === hl ? ", matched to the other submap" : "");
        img.width = w; img.height = h;
        img.className = "p03-photo" + (i === hl ? " hl" : "");
        img.style.left = xs[i] + "px";
        img.style.top = row.top + "px";
        host.appendChild(img);
        svgEl(g("p03-stems"), "path", { d: row.below ? `M${px} ${row.top + h} L${x} ${y}` : `M${x} ${y} L${px} ${row.top}` });
        svgEl(g("p03-dots"), "circle", { cx: x, cy: y, r: 8, class: i === hl ? "hl" : "" });
      });
    });
    const [a, b] = M.match;
    g("p03-match").setAttribute("d", `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`);
    const ll = g("p03-loop-lab");
    ll.style.left = (Math.max(a[0], b[0]) + 22) + "px"; ll.style.top = ((a[1] + b[1]) / 2 - 11) + "px";
    const bx = cx + 14, by = cy + 34;  // scale bar in the window's empty top-left corner
    g("p03-bar").setAttribute("d", `M${bx} ${by - 8} V${by} H${bx + M.bar.px} V${by - 8}`);
    const lab = g("p03-bar-lab");
    lab.style.left = (bx + M.bar.px / 2) + "px"; lab.style.top = (by + 10) + "px";
  }

  // ---------- P04: the paper's Fig. 2 as five blocks; small schematic graphs drawn here ----------
  const P04_NODES = [[20, 42], [76, 22], [128, 44], [184, 20], [236, 40]];

  function buildP04() {
    const nodes = (svg, pts, fill = C.fg) => pts.forEach(([cx, cy]) => svgEl(svg, "circle", { cx, cy, r: 7, fill, stroke: C.surface, "stroke-width": 2 }));
    const seg = (svg, a, b, attrs) => svgEl(svg, "path", { d: `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`, fill: "none", ...attrs });
    const arc = (svg, a, b, attrs) => svgEl(svg, "path", { d: `M${a[0]} ${a[1]} Q${(a[0] + b[0]) / 2} ${Math.min(a[1], b[1]) - 26} ${b[0]} ${b[1]}`, fill: "none", ...attrs });
    const N = P04_NODES, chain = [[0, 1], [1, 2], [2, 3], [3, 4]];
    const covis = document.getElementById("p04-l-covis"), odom = document.getElementById("p04-l-odom"), trav = document.getElementById("p04-l-trav");
    if (!covis) return;
    // same five photos in each layer, three different edge sets
    [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4]].forEach(([i, j]) => arc(covis, N[i], N[j], { stroke: C.green, "stroke-width": 3, "stroke-dasharray": "7 5" }));
    chain.forEach(([i, j]) => seg(odom, N[i], N[j], { stroke: C.fg, "stroke-width": 3 }));
    [...chain, [1, 3]].forEach(([i, j]) => seg(trav, N[i], N[j], { stroke: C.island, "stroke-width": 12, "stroke-linecap": "round", opacity: 0.45 }));
    // nodes are image keyframes: draw each as a small camera frustum facing along the path
    const cams = (svg, pts) => pts.forEach(([cx, cy], i) => {
      const [nx, ny] = pts[Math.min(i + 1, pts.length - 1)], [px, py] = pts[Math.max(i - 1, 0)];
      const a = Math.atan2(ny - py, nx - px) * 180 / Math.PI;
      svgEl(svg, "path", { d: "M-9 0 L9 -10 L9 10 Z", transform: `translate(${cx} ${cy}) rotate(${a})`, fill: C.surface, stroke: C.fg, "stroke-width": 2.5, "stroke-linejoin": "round" });
    });
    [covis, odom, trav].forEach((svg) => cams(svg, N));

    // pose graph optimization: the new piece (green) moves onto the map (grey) once a link joins them
    const pgo = document.getElementById("p04-pgo");
    const grey = [[20, 30], [60, 26], [100, 32], [140, 28]], ghost = [[196, 52], [236, 56], [276, 50], [316, 54]];
    const done = ghost.map(([x, y]) => [x, y - 24]);
    for (let i = 0; i < 3; i++) {
      seg(pgo, grey[i], grey[i + 1], { stroke: C.gray1, "stroke-width": 3 });
      seg(pgo, ghost[i], ghost[i + 1], { stroke: C.dim, "stroke-width": 2, "stroke-dasharray": "4 4" });
      seg(pgo, done[i], done[i + 1], { stroke: C.green, "stroke-width": 3 });
    }
    seg(pgo, grey[3], done[0], { stroke: C.green, "stroke-width": 3, "stroke-dasharray": "7 5" });
    ghost.forEach(([x, y]) => svgEl(pgo, "circle", { cx: x, cy: y, r: 5, fill: "none", stroke: C.dim, "stroke-width": 2 }));
    nodes(pgo, grey, C.gray1);
    nodes(pgo, done, C.green);

    // maintenance: before (top) two near-duplicate photos are dropped; after (bottom) a new photo and fresh links
    const m = document.getElementById("p04-maint");
    const before = [[20, 60], [62, 48], [104, 62], [118, 58], [160, 50], [174, 54], [236, 60]];
    for (let i = 0; i < before.length - 1; i++) seg(m, before[i], before[i + 1], { stroke: C.fg, "stroke-width": 3 });
    nodes(m, before);
    [before[3], before[5]].forEach(([x, y]) => {
      svgEl(m, "circle", { cx: x, cy: y, r: 11, fill: C.surface, stroke: C.dim, "stroke-width": 2 });
      seg(m, [x - 6, y - 6], [x + 6, y + 6], { stroke: C.muted, "stroke-width": 3 });
      seg(m, [x - 6, y + 6], [x + 6, y - 6], { stroke: C.muted, "stroke-width": 3 });
    });
    svgEl(m, "path", { d: "M128 112 V176 M118 164 L128 178 L138 164", fill: "none", stroke: C.muted, "stroke-width": 2.5 });
    const after = [[20, 240], [62, 228], [104, 242], [160, 230], [236, 240]], fresh = [198, 270];
    for (let i = 0; i < after.length - 1; i++) seg(m, after[i], after[i + 1], { stroke: C.fg, "stroke-width": 3 });
    arc(m, after[1], after[3], { stroke: C.green, "stroke-width": 3, "stroke-dasharray": "7 5" });
    seg(m, after[3], fresh, { stroke: C.green, "stroke-width": 3 });
    seg(m, fresh, after[4], { stroke: C.green, "stroke-width": 3 });
    nodes(m, after);
    nodes(m, [fresh], C.green);
  }

  // step buttons: nothing moves on its own. A chip highlights its block ("All" = none dimmed); Prev / Next walk 1..5.
  // Presenting P04, a chip or Prev / Next sets the talk step, so the arrow keys continue from there.
  function initP04Steps() {
    const inner = document.getElementById("p04-inner");
    if (!inner) return;
    const pick = (k) => {
      if (html.dataset.mode === "present" && order[cur] === "p04") show(cur, Math.max(1, k));
      else p04Highlight(k);
    };
    document.querySelectorAll("[data-p04-step]").forEach((b) => b.addEventListener("click", () => pick(Number(b.dataset.p04Step))));
    document.querySelectorAll("[data-p04-nav]").forEach((b) => b.addEventListener("click", () => {
      const now = Number(inner.dataset.hl) || 0;
      pick(now === 0 ? 1 : Math.max(1, Math.min(5, now + Number(b.dataset.p04Nav))));
    }));
  }

  // ---------- P03 right: the 3D the model infers from one photo pair, rocking about the vertical ----------
  const b64 = (s) => {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };

  function makeCloud() {
    const cv = document.getElementById("p03-cloud");
    const D = window.ONM_CLOUD;
    if (!cv || !D) return null;
    const S = 2, W = cv.width * S, H = cv.height * S;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const q = new Int16Array(b64(D.pts)), rgb = new Uint8Array(b64(D.rgb));
    const n = D.n, pts = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pts[i] = q[i] * D.scale;
    const { pivot, dist } = D.view, f = 1450, pitch = 0.42, cx = W / 2, cy = H * 0.5;
    const img = ctx.createImageData(W, H), zb = new Float32Array(W * H);
    const bg = [1, 3, 5].map((i) => parseInt(C.surface.slice(i, i + 2), 16));
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (x, y, z, ct, st) => {
      x -= pivot[0]; y -= pivot[1]; z -= pivot[2];
      const x1 = ct * x + st * z, z1 = -st * x + ct * z;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp + dist;
      return [cx + f * x1 / z2, cy + f * y2 / z2, z2];
    };
    const frustum = (cam, ct, st, colour) => {
      const d = D.view.frustum || 0.9, hw = d * D.intr.w / 2 / D.intr.fx, hh = d * D.intr.h / 2 / D.intr.fx, R = cam.R, c = cam.c;
      const world = (x, y, z) => [0, 1, 2].map((r) => R[r][0] * x + R[r][1] * y + R[r][2] * z + c[r]);
      const o = proj(...c, ct, st);
      const k = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => proj(...world(x, y, d), ct, st));
      ctx.strokeStyle = colour; ctx.lineWidth = 3 * S / 2 + 1; ctx.lineJoin = "round";
      ctx.beginPath();
      k.forEach((p) => { ctx.moveTo(o[0], o[1]); ctx.lineTo(p[0], p[1]); });
      ctx.moveTo(k[0][0], k[0][1]); k.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(o[0], o[1], 5 * S / 2 + 2, 0, 2 * Math.PI); ctx.fill();
    };
    const render = (theta) => {
      const ct = Math.cos(theta), st = Math.sin(theta), buf = img.data;
      for (let i = 0; i < buf.length; i += 4) { buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; buf[i + 3] = 255; }
      zb.fill(Infinity);
      for (let i = 0; i < n; i++) {
        const [u, v, z] = proj(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], ct, st);
        if (z < 0.5) continue;
        const u0 = u | 0, v0 = v | 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const x = u0 + dx, y = v0 + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const j = y * W + x;
            if (z >= zb[j]) continue;
            zb[j] = z;
            buf[4 * j] = rgb[3 * i]; buf[4 * j + 1] = rgb[3 * i + 1]; buf[4 * j + 2] = rgb[3 * i + 2];
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      frustum(D.cams[0], ct, st, C.gray1);
      frustum(D.cams[1], ct, st, C.green);
    };
    const AMP = 20 * Math.PI / 180, PERIOD = 9000, STILL = 0.35;
    let raf = 0, visible = false, t0 = performance.now();
    const loop = (now) => { render(AMP * Math.sin(2 * Math.PI * (now - t0) / PERIOD)); raf = requestAnimationFrame(loop); };
    const api = {
      still() { cancelAnimationFrame(raf); raf = 0; render(STILL); },
      play() { if (!raf && !reduced && html.dataset.mode !== "capture") { t0 = performance.now(); raf = requestAnimationFrame(loop); } },
      pause() { cancelAnimationFrame(raf); raf = 0; },
    };
    api.still();
    const small = document.getElementById("p04-cloud"); // P04 block 3 reuses one still frame of this render
    if (small) {
      small.width = 672; small.height = Math.round(672 * H / W);
      small.getContext("2d").drawImage(cv, 0, 0, W, H, 0, 0, small.width, small.height);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((en) => en.forEach((e) => {
        visible = e.isIntersecting;
        if (visible) api.play(); else api.pause();
      })).observe(cv);
    }
    return api;
  }

  // ---------- merge animation (hero and p05): one piece added per step ----------
  const MERGE = (() => {
    const M = window.ONM_MERGE;
    if (!M) return null;
    const xy = new Int16Array(b64(M.xy)), ln = new Uint16Array(b64(M.links));
    const off = [], loff = [];
    let a = 0, b = 0;
    M.steps.forEach((s) => { off.push(a); loff.push(b); a += s.n; b += s.nl; });
    // steps[].unl = node ranges outside the main component: no known place on the map, so these views skip them
    const unl = (k, i) => M.steps[k].unl.some(([a, c]) => i >= a && i < c);
    return { M, xy, ln, off, loff, unl, last: M.steps.length - 1 };
  })();

  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const fmt2 = (v) => (Math.round(v * 100 + 1e-6) / 100).toFixed(2);

  // Camera = metres-to-stage scale + map point at the box centre. Fixed: fits the whole run.
  // Follow (p05): fits everything merged up to step k (+ PAD each side), never zooms back in.
  function mergeCams(box, follow) {
    const { M, xy, off } = MERGE, q = M.q;
    const bw = box[2] - box[0], bh = box[3] - box[1];
    const fitCam = (x0, y0, x1, y1, pad) => {
      const w = Math.max(x1 - x0, MIN_VIEW_M), h = Math.max(y1 - y0, MIN_VIEW_M);
      return { sc: Math.min(bw / (w * (1 + 2 * pad)), bh / (h * (1 + 2 * pad))), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    };
    if (!follow) return M.steps.map(() => fitCam(...M.bbox, 0));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sc = Infinity;
    return M.steps.map((s, k) => {
      for (let i = off[k]; i < off[k] + s.n; i++) {
        if (MERGE.unl(k, i - off[k])) continue;
        const x = xy[2 * i] / q, y = xy[2 * i + 1] / q;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const c = fitCam(x0, y0, x1, y1, PAD);
      sc = Math.min(sc, c.sc);
      return { sc, cx: c.cx, cy: c.cy };
    });
  }

  function mergeView(canvas, box, opts) {
    const ctx = canvas.getContext("2d");
    const { M, xy, ln, off, loff } = MERGE;
    const cams = mergeCams(box, opts.follow);
    const mx = (box[0] + box[2]) / 2, my = (box[1] + box[3]) / 2;
    const q = M.q;
    let cam = cams[cams.length - 1];
    const X = (i) => mx + cam.sc * (xy[2 * i] / q - cam.cx), Y = (i) => my - cam.sc * (xy[2 * i + 1] / q - cam.cy);
    const brk = (BREAK_M * q) ** 2;
    const far = (i, j) => (xy[2 * i] - xy[2 * j]) ** 2 + (xy[2 * i + 1] - xy[2 * j + 1]) ** 2 > brk;
    const trace = (start, count) => {
      for (let i = start; i < start + count; i++) {
        if (i === start || far(i - 1, i)) ctx.moveTo(X(i), Y(i)); else ctx.lineTo(X(i), Y(i));
      }
    };
    const joinStep = (piece) => M.steps.findIndex((s) => s.piece === piece);
    const pins = (opts.pins || []).map((el) => ({ el, node: Number(el.dataset.node), from: joinStep(Number(el.dataset.piece)),
      x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.width, h: el.height }));
    function drawPins(k, base) {
      pins.forEach((p) => {
        const on = k >= p.from;
        if (p.el.hidden === on) p.el.hidden = !on;
        if (!on || MERGE.unl(k, p.node)) { if (!p.el.hidden) p.el.hidden = true; return; }
        const nx = X(base + p.node), ny = Y(base + p.node);
        const ax = Math.min(Math.max(nx, p.x), p.x + p.w), ay = Math.min(Math.max(ny, p.y), p.y + p.h);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(nx, ny);
        ctx.strokeStyle = C.dim; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(nx, ny, 7, 0, 2 * Math.PI);
        ctx.fillStyle = C.fg; ctx.fill(); ctx.strokeStyle = C.surface; ctx.lineWidth = 2.5; ctx.stroke();
      });
    }
    function drawMarker(x, y, k) {
      ctx.beginPath(); ctx.arc(x, y, 18, 0, 2 * Math.PI);
      ctx.strokeStyle = C.green; ctx.lineWidth = 1.5; ctx.stroke();
      if (!opts.label) return;
      const txt = "submap " + String(k + 1).padStart(2, "0");
      ctx.font = `500 ${MIN_STAGE_TEXT}px "JetBrains Mono", monospace`;
      ctx.fillStyle = C.ink; ctx.textBaseline = "middle";
      const w = ctx.measureText(txt).width, right = x + 28 + w <= box[2];
      ctx.textAlign = right ? "left" : "right";
      // a stage-coloured halo keeps the label readable where it crosses old lines
      ctx.lineWidth = 6; ctx.strokeStyle = C.stage;
      ctx.strokeText(txt, right ? x + 28 : x - 28, y);
      ctx.fillText(txt, right ? x + 28 : x - 28, y);
    }
    // filmstrip of the incoming piece (atlas row k), with a leader from each photo to where it was taken;
    // photos are laid out west to east so the leaders do not cross
    let stripRow = -1, perm = [];
    function drawStrip(k, start, shown) {
      const { frames, label } = opts.strip, S = M.strip, narrow = !!frames[0].closest(".narrow"), offs = M.steps[k].strip;
      if (stripRow !== k) {
        stripRow = k;
        // number the piece by merge step, as the counter does (the data label carries the dataset's piece id)
        const lab = M.steps[k].label;
        label.textContent = "submap " + String(k + 1).padStart(2, "0") + lab.slice(lab.indexOf(" ·"));
        perm = offs.map((o, j) => j).sort((a, b) => xy[2 * (start + offs[a])] - xy[2 * (start + offs[b])]);
        frames.forEach((el, j) => {
          el.style.backgroundPosition = `${(100 * perm[j] / (S.n - 1)).toFixed(3)}% ${(100 * k / MERGE.last).toFixed(4)}%`;
          el.dataset.row = k;
        });
      }
      ctx.save();
      ctx.strokeStyle = C.green; ctx.fillStyle = C.green; ctx.lineWidth = 1.5;
      frames.forEach((el, j) => {
        const o = offs[perm[j]];
        if (o >= shown || (narrow && el.dataset.narrow === "hide")) return;
        const nx = X(start + o), ny = Y(start + o), fx = el.offsetLeft + el.offsetWidth / 2, fy = el.offsetTop;
        ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(nx, ny, 5, 0, 2 * Math.PI); ctx.fill();
      });
      ctx.restore();
    }
    function draw(k, t) {
      const s = M.steps[k], base = off[k];
      const a = cams[Math.max(0, k - 1)], b = cams[k], e = ease(t);
      cam = { sc: a.sc + (b.sc - a.sc) * e, cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e };
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      let i = base, newStart = -1, newCount = 0;
      ctx.beginPath();
      s.runs.forEach(([w, c], r) => {
        if (MERGE.unl(k, i - base)) { /* not linked yet: no place on the map, not drawn here */ } else if (w === s.piece) { newStart = i; newCount = c; } else trace(i, c);
        i += c;
      });
      ctx.strokeStyle = C.text; ctx.lineWidth = 2.5; ctx.globalAlpha = OLD_ALPHA;
      ctx.stroke();
      ctx.globalAlpha = 1;
      let end = null;
      if (newStart >= 0) {
        const shown = Math.max(1, Math.ceil(newCount * ease(t)));
        ctx.beginPath(); trace(newStart, shown);
        ctx.strokeStyle = C.green; ctx.lineWidth = 5; ctx.stroke();
        end = newStart + shown - 1;
        if (opts.strip) drawStrip(k, newStart, shown);
      }
      if (s.nl && t > 0.5) {
        // links flash in, then settle to a thin dash
        ctx.globalAlpha = Math.min(1, (t - 0.5) * 4);
        ctx.setLineDash([10, 8]); ctx.strokeStyle = C.green; ctx.lineWidth = 2 + 3 * Math.max(0, 1 - (t - 0.5) * 2.5);
        ctx.beginPath();
        for (let j = loff[k]; j < loff[k] + s.nl; j++) {
          const p = base + ln[2 * j], r = base + ln[2 * j + 1];
          ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(r), Y(r));
        }
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      drawPins(k, base);
      if (end !== null) drawMarker(X(end), Y(end), k);
      ctx.restore();
      if (opts.onCam) opts.onCam(cam.sc);
    }
    return { draw };
  }

  function mergePlayer(view, onStep, stepMs = () => STEP_MS) {
    let k = MERGE.last, t0 = 0, raf = 0, shown = -1;
    const frame = (now) => {
      const el = now - t0, ms = stepMs(k);
      if (k < MERGE.last) {
        view.draw(k, Math.min(1, el / ms));
        if (el >= ms) { k++; t0 = now; onStep(k); }
      } else if (shown !== k || el < ms) {
        view.draw(k, Math.min(1, el / ms));
        shown = el >= ms ? k : -1;
      } else if (el >= ms + HOLD_MS) {
        k = 0; t0 = now; shown = -1; onStep(k);
      }
      raf = requestAnimationFrame(frame);
    };
    const p = {
      playing: false,
      show(n, t = 1) { p.pause(); k = n; shown = -1; view.draw(k, t); onStep(k); },
      redraw() { if (!p.playing) view.draw(k, Number(params.get("t") || 1)); },
      play() { if (raf) return; p.playing = true; t0 = performance.now() - (k === MERGE.last ? stepMs(k) : 0); raf = requestAnimationFrame(frame); },
      pause() { cancelAnimationFrame(raf); raf = 0; p.playing = false; },
      replay() { p.pause(); k = 0; shown = -1; onStep(k); view.draw(k, 0); p.play(); },
    };
    return p;
  }

  const players = {};

  function initMerge() {
    if (!MERGE) return;
    const steps = MERGE.M.steps, total = steps.length;
    const hero = document.getElementById("hero-canvas");
    const heroPiece = document.getElementById("hero-piece");
    if (hero) {
      // HERO_BOX in render/build_hero_photos.py must match this box (it places the pinned photos)
      const pins = [...document.querySelectorAll("#p00 .hero-pin")];
      const v = mergeView(hero, [500, 64, 1870, 1036], { pins });
      players.p00 = mergePlayer(v, (k) => { heroPiece.textContent = String(k + 1).padStart(2, "0"); });
    }
    const cv = document.getElementById("p05-canvas");
    if (cv && !window.ONM_PROC) { // with the process data loaded, js/r4_merge.js drives p05
      const bar = document.getElementById("p05-scalebar-line"), barLabel = document.getElementById("p05-scalebar-m");
      const onCam = (sc) => {
        const m = [...SCALE_BAR_M].reverse().find((v) => v * sc <= SCALE_BAR_PX) || SCALE_BAR_M[0];
        bar.style.width = (m * sc).toFixed(1) + "px";
        if (barLabel.textContent !== String(m)) barLabel.textContent = String(m);
      };
      const strip = { frames: [...document.querySelectorAll("#p05 .p05-frame")], label: document.getElementById("p05-strip-label") };
      const atlas = new Image();
      atlas.onload = () => { if (players.p05 && !players.p05.playing) players.p05.redraw(); };
      atlas.src = MERGE.M.strip.src;
      strip.frames.forEach((el) => { el.style.backgroundImage = `url("${MERGE.M.strip.src}")`; });
      const v = mergeView(cv, [96, 236, 1360, 850], { follow: true, label: true, onCam, strip });
      const pieceEl = document.getElementById("p05-piece"), rmsEl = document.getElementById("p05-rms");
      players.p05 = mergePlayer(v, (k) => {
        pieceEl.textContent = String(k + 1).padStart(2, "0");
        rmsEl.textContent = fmt2(steps[k].ate);
      }, (k) => (k < P05_SLOW_STEPS ? P05_SLOW_MS : P05_FAST_MS));
      players.p05.atlas = atlas;
      const toggle = document.querySelector('[data-anim="toggle"]');
      const label = () => { toggle.textContent = players.p05.playing ? "Pause" : "Play"; toggle.setAttribute("aria-pressed", String(!players.p05.playing)); };
      let userPaused = reduced;
      toggle.addEventListener("click", () => {
        if (players.p05.playing) { players.p05.pause(); userPaused = true; } else { players.p05.play(); userPaused = false; }
        label();
      });
      document.querySelector('[data-anim="replay"]').addEventListener("click", () => { userPaused = false; players.p05.replay(); label(); });
      players.p05.label = label;
      players.p05.auto = (on) => {
        if (on && !userPaused) players.p05.play(); else if (!on) players.p05.pause();
        label();
      };
    }
    Object.values(players).forEach((p) => p.show(total - 1));
  }

  function autoplayInScroll() {
    if (!("IntersectionObserver" in window) || reduced) return;
    const io = new IntersectionObserver((en) => en.forEach((e) => {
      if (html.dataset.mode !== "scroll") return;
      const id = e.target.closest(".panel").id, p = players[id];
      const on = e.intersectionRatio >= 0.5;
      if (p.auto) p.auto(on); else if (on) p.play(); else p.pause();
    }), { threshold: [0, 0.5] });
    if (players.p00) io.observe(document.getElementById("hero-canvas"));
    if (players.p05) io.observe(document.getElementById("p05-canvas"));
  }

  // in present / speaker mode, an animated panel starts from the first piece when shown
  function syncPlayers(id) {
    Object.entries(players).forEach(([pid, p]) => {
      if (pid === id && !reduced) p.replay(); else p.pause();
      if (p.label) p.label();
    });
  }

  // ---------- on-this-page nav ----------
  function buildToc() {
    document.querySelectorAll('[data-action="present"]').forEach((b) => b.addEventListener("click", () => enterPresent()));
    const nav = document.querySelector(".toc-links");
    if (!nav || html.dataset.view === "chapters") return; // chapter view: js/chapters.js lists the chapters
    const items = WEB_ORDER.filter((id) => panels[id] && panels[id].dataset.toc).map((id) => [id, panels[id].dataset.toc]);
    items.push(["cite", "Cite"]);
    const links = items.map(([id, name], i) => {
      const a = document.createElement("a");
      a.href = "#" + id;
      a.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>`;
      a.appendChild(document.createTextNode(name));
      nav.appendChild(a);
      return a;
    });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => {
          const on = a.hash === "#" + en.target.id;
          a.setAttribute("aria-current", String(on));
          if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
        });
      }), { rootMargin: "-40% 0px -55% 0px" });
      items.forEach(([id]) => io.observe(document.getElementById(id)));
    }
  }

  function initBibCopy() {
    const btn = document.querySelector('[data-action="copy-bib"]');
    if (!btn) return;
    btn.addEventListener("click", () => {
      const text = document.getElementById("bibtex").textContent;
      const done = () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => {});
      else {
        const r = document.createRange();
        r.selectNodeContents(document.getElementById("bibtex"));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        try { document.execCommand("copy"); done(); } catch (e) { /* text stays selected for manual copy */ }
      }
    });
  }

  // ---------- present / capture / speaker ----------
  function titleOf(id) {
    const t = panels[id] && panels[id].querySelector(".panel-title");
    return t && t.textContent.trim() ? t.textContent.trim() : "(live footage, no title)";
  }

  function show(i, n) {
    cur = Math.max(0, Math.min(order.length - 1, i));
    const id = order[cur];
    const panel = panels[id];
    const changed = html.dataset.current !== id;
    Object.values(panels).forEach((p) => p.classList.toggle("is-current", p === panel));
    step = Math.max(1, Math.min(maxStep(panel), n));
    setStep(panel, step);
    html.dataset.current = id;
    html.dataset.step = String(step);
    pageNum.textContent = (cur + 1) + " / " + order.length;
    const stage = panel.querySelector(".stage");
    if (stage) requestAnimationFrame(() => fit(stage));
    if (changed && (html.dataset.mode === "present" || html.dataset.mode === "speaker")) syncPlayers(id);
    if (html.dataset.mode === "present") {
      history.replaceState(null, "", location.pathname + location.search + "#" + id);
      updateNotes();
      postState();
    }
    if (html.dataset.mode === "speaker") updateSpeaker();
  }

  function go(i, n) {
    if (order[i] !== order[cur]) panelStart = Date.now();
    show(i, n);
  }

  function next() {
    if (step < maxStep(panels[order[cur]])) show(cur, step + 1);
    else if (cur < order.length - 1) go(cur + 1, 1);
  }

  function prev() {
    if (step > 1) show(cur, step - 1);
    else if (cur > 0) go(cur - 1, maxStep(panels[order[cur - 1]]));
  }

  function visiblePanelId() {
    for (const id of WEB_ORDER) {
      const r = panels[id].getBoundingClientRect();
      if (r.bottom > 160) return id;
    }
    return WEB_ORDER[0];
  }

  function enterPresent(id) {
    const start = id || visiblePanelId();
    html.dataset.mode = "present";
    order = TALK_ORDER;
    talkStart = Date.now();
    panelStart = Date.now();
    delete html.dataset.current;
    go(Math.max(0, order.indexOf(start)), 1);
    document.body.focus();
  }

  function exitPresent() {
    const id = order[cur] === "hook" ? "p00" : order[cur];
    if (document.fullscreenElement) document.exitFullscreen();
    html.dataset.mode = "scroll";
    delete html.dataset.current;
    delete html.dataset.step;
    Object.values(panels).forEach((p) => { p.classList.remove("is-current"); setStep(p, maxStep(p)); });
    Object.values(players).forEach((p) => { p.show(MERGE.last); if (p.label) p.label(); });
    document.getElementById("notes-overlay").hidden = true;
    history.replaceState(null, "", location.pathname + location.search.replace(/[?&]present=1/, "") + "#" + id);
    requestAnimationFrame(() => { document.querySelectorAll(".stage").forEach(fit); panels[id].scrollIntoView(); });
  }

  function updateNotes() {
    const box = document.getElementById("notes-overlay");
    const notes = panels[order[cur]].querySelector(".panel-notes");
    box.textContent = notes ? notes.textContent.trim() : "";
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (html.requestFullscreen) html.requestFullscreen().catch(() => {});
  }

  // speaker window: same page with ?speaker=1, kept in sync by window.open + postMessage
  function openSpeaker() {
    const url = location.href.split(/[?#]/)[0] + "?speaker=1#" + order[cur];
    speakerWin = window.open(url, "onm-speaker", "width=1200,height=760");
  }

  function postState() {
    if (speakerWin && !speakerWin.closed) {
      speakerWin.postMessage({ type: "onm-state", id: order[cur], step, talkStart, panelStart }, "*");
    }
  }

  const fmtTime = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };

  function updateSpeaker() {
    const id = order[cur];
    const target = Number(panels[id].dataset.talkSeconds || 0) * 1000;
    const spent = Date.now() - panelStart;
    document.getElementById("sb-total").textContent = fmtTime(Date.now() - talkStart);
    const p = document.getElementById("sb-panel");
    p.textContent = fmtTime(spent);
    p.classList.toggle("over", target > 0 && spent > target);
    document.getElementById("sb-target").textContent = fmtTime(target);
    document.getElementById("sb-step").textContent = step + " / " + maxStep(panels[id]);
    document.getElementById("sb-next").textContent = cur < order.length - 1 ? titleOf(order[cur + 1]) : "(end)";
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && (e.key === " " || e.key === "Enter")) return;
    const mode = html.dataset.mode;
    const k = e.key;
    if (mode === "scroll") {
      if (k === "p" || k === "P") { e.preventDefault(); enterPresent(); }
      return;
    }
    if (mode === "speaker") {
      if (window.opener) window.opener.postMessage({ type: "onm-key", key: k }, "*");
      return;
    }
    if (mode !== "present") return;
    if (handlePresentKey(k)) e.preventDefault();
  }

  function handlePresentKey(k) {
    switch (k) {
      case "ArrowRight": case " ": case "Spacebar": case "PageDown": next(); break;
      case "ArrowLeft": case "PageUp": prev(); break;
      case "Home": go(0, 1); break;
      case "End": go(order.length - 1, 1); break;
      case "f": case "F": toggleFullscreen(); break;
      case "n": case "N": {
        const box = document.getElementById("notes-overlay");
        updateNotes();
        box.hidden = !box.hidden;
        break;
      }
      case "s": case "S": openSpeaker(); break;
      case "p": case "P": case "Escape": exitPresent(); break;
      default: return false;
    }
    return true;
  }

  function onMessage(e) {
    const d = e.data || {};
    if (html.dataset.mode === "present" && speakerWin && e.source === speakerWin) {
      if (d.type === "onm-hello") postState();
      if (d.type === "onm-key") handlePresentKey(d.key);
    }
    if (html.dataset.mode === "speaker" && e.source === window.opener && d.type === "onm-state") {
      talkStart = d.talkStart;
      panelStart = d.panelStart;
      show(Math.max(0, order.indexOf(d.id)), d.step);
    }
  }

  function hashIndex() {
    const id = location.hash.slice(1);
    return order.indexOf(id);
  }

  // ---------- start ----------
  // presenting: slide number in the bottom-right corner of the slide (CSS shows it only in present mode)
  const pageNum = document.createElement("div");
  pageNum.className = "page-num";
  pageNum.setAttribute("aria-hidden", "true");
  document.body.appendChild(pageNum);
  fillNumbers();
  initStepChips();
  buildToc();
  buildP02();
  buildP03();
  buildP04();
  initStages();
  initMerge();
  initP04Steps();
  initBibCopy();
  document.addEventListener("keydown", onKey);
  window.addEventListener("message", onMessage);

  const capture = params.get("capture");
  if (capture && panels[capture]) {
    html.dataset.mode = "capture";
    order = [capture];
    show(0, Number(params.get("step")) || 1);
    const frame = Math.max(1, Math.min(MERGE ? MERGE.last + 1 : 1, Number(params.get("frame")) || Infinity));
    const t = Math.max(0, Math.min(1, Number(params.get("t") || 1)));
    if (players[capture]) players[capture].show(frame - 1, t);
  } else if (params.get("speaker")) {
    html.dataset.mode = "speaker";
    document.getElementById("speaker-bar").hidden = false;
    show(Math.max(0, hashIndex()), Number(params.get("step")) || 1);
    setInterval(updateSpeaker, 500);
    if (window.opener) window.opener.postMessage({ type: "onm-hello" }, "*");
  } else if (params.get("present")) {
    const i = hashIndex();
    enterPresent(i >= 0 ? order[i] : "p00");
  } else {
    Object.values(panels).forEach((p) => setStep(p, maxStep(p)));
    initAutoSteps();
    autoplayInScroll();
  }
  makeCloud();
  window.ONM_PLAYERS = players; // test hook for headless checks

  window.addEventListener("hashchange", () => {
    if (html.dataset.mode !== "present") return;
    const i = hashIndex();
    if (i >= 0 && i !== cur) go(i, 1);
  });

  // test hook for headless checks: ?present=1&keys=ArrowRight,ArrowRight
  const keys = params.get("keys");
  if (keys) {
    keys.split(",").forEach((k) => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: k === "Space" ? " " : k, bubbles: true }));
    });
  }
})();
