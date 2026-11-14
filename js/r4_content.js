"use strict";
// Round 4 content: one play bar per navigation sub-page (#p08c-#p08f). Loaded after site.js.
// data-r4-group="pair": two clips of one run, kept on one clock. "all": clips start together, each at its own speed;
// the bar follows the longest and a shorter clip holds its last frame.
// data-r4-end: a time in s where the bar ends (the run has arrived; later frames are the next task), or "shortest" to follow
// the shortest clip instead. data-r4-loop: at the end all clips restart together; without it they stop there.
(function () {
  const html = document.documentElement;
  const players = window.ONM_PLAYERS;
  if (!players) return;
  const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

  document.querySelectorAll("[data-r4-group]").forEach((inner) => {
    const panel = inner.closest(".panel");
    if (!panel) return;
    const vids = [...inner.querySelectorAll("video")];
    const toggles = [...panel.querySelectorAll('[data-r4="toggle"]')];
    const seek = inner.querySelector('[data-r4="seek"]'), time = inner.querySelector('[data-r4="time"]');
    const pair = inner.dataset.r4Group === "pair";
    const shortest = inner.dataset.r4End === "shortest", end_s = Number(inner.dataset.r4End) || Infinity;
    const loop = "r4Loop" in inner.dataset;
    const len = (v, none) => v.duration || none;
    const main = () => vids.reduce((m, v) => (shortest ? len(v, Infinity) < len(m, Infinity) : len(v, 0) > len(m, 0)) ? v : m, vids[0]);
    const total = () => Math.min(main().duration || 0, end_s);

    const ui = () => {
      const m = main(), d = total(), playing = vids.some((v) => !v.paused && !v.ended);
      toggles.forEach((t) => { t.textContent = playing ? "Pause" : "Play"; });
      if (d && seek && time) {
        const t = Math.min(m.currentTime, d);
        if (document.activeElement !== seek) seek.value = String(Math.round(1000 * t / d));
        time.textContent = mmss(t) + " / " + mmss(d);
      }
    };
    const setTime = (t) => vids.forEach((v) => { if (v.duration) v.currentTime = Math.min(t, v.duration - 0.05); });
    const run = () => {
      const m = main();
      if (m.ended || m.currentTime >= total() - 0.05) setTime(0);
      vids.forEach((v) => { if (!v.duration || v.currentTime < v.duration - 0.05) v.play().catch(() => {}); });
    };
    const stop = () => vids.forEach((v) => v.pause());

    toggles.forEach((t) => t.addEventListener("click", () => {
      if (vids.some((v) => !v.paused && !v.ended)) stop(); else run();
      ui();
    }));
    if (seek) seek.addEventListener("input", () => { if (total()) setTime(total() * Number(seek.value) / 1000); ui(); });
    vids.forEach((v) => ["loadedmetadata", "timeupdate", "play", "pause", "ended"].forEach((ev) => v.addEventListener(ev, ui)));
    if (shortest || end_s < Infinity) {
      const atEnd = (e) => {
        const m = main(), d = total();
        if (e.target !== m || !d || (e.type === "timeupdate" && (m.paused || m.currentTime < d - 0.05))) return;
        if (loop) { setTime(0); vids.forEach((v) => v.play().catch(() => {})); } else { stop(); setTime(d - 0.04); }
        ui();
      };
      vids.forEach((v) => ["timeupdate", "ended"].forEach((ev) => v.addEventListener(ev, atEnd)));
    }
    if (pair) {
      vids[0].addEventListener("timeupdate", () => {
        const m = main();
        vids.forEach((o) => {
          if (o !== m && !m.paused && o.duration && m.currentTime < o.duration && Math.abs(o.currentTime - m.currentTime) > 0.3) o.currentTime = m.currentTime;
        });
      });
    }

    players[panel.id] = {
      get playing() { return vids.some((v) => !v.paused); },
      // back to the posters: a never-seeked video shows its poster (capture mode relies on this)
      show() { stop(); vids.forEach((v) => { if (v.currentTime > 0) v.load(); }); ui(); },
      pause() { stop(); ui(); },
      // plays on its own only in present mode
      replay() { if (html.dataset.mode !== "present") { stop(); return; } setTime(0); run(); ui(); },
      label: ui,
    };
    ui();
    // site.js may already have entered present mode on this panel before this file ran
    if (html.dataset.mode === "present" && panel.classList.contains("is-current")) players[panel.id].replay();
  });

  // P01b: each device clip loops while its step is shown and the panel is on screen; capture mode keeps the posters
  const p1 = document.getElementById("p01b");
  if (p1) {
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tiles = [...p1.querySelectorAll(".i1-tile[data-step]")].map((f) => [Number(f.dataset.step), f.querySelector("video")]).filter((t) => t[1]);
    let inView = false;
    const sync = () => {
      const mode = html.dataset.mode, n = Number(p1.dataset.stepNow) || Infinity;
      const on = !reduced && (mode === "scroll" ? inView : (mode === "present" || mode === "speaker") && p1.classList.contains("is-current"));
      tiles.forEach(([s, v]) => { if (on && s <= n) v.play().catch(() => {}); else v.pause(); });
    };
    p1.addEventListener("onm-step", sync);
    new MutationObserver(sync).observe(p1, { attributes: true, attributeFilter: ["class"] });
    if ("IntersectionObserver" in window) new IntersectionObserver((en) => { inView = en[0].isIntersecting; sync(); }, { threshold: 0.25 }).observe(p1);
    sync();
  }

  // P05a: one looping clip, played while the panel is on screen; capture mode keeps the poster
  const p5 = document.getElementById("p05a"), v5 = p5 && p5.querySelector("video");
  if (v5) {
    let inView = false;
    const sync = () => {
      const mode = html.dataset.mode, reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const on = !reduced && (mode === "scroll" ? inView : (mode === "present" || mode === "speaker") && p5.classList.contains("is-current"));
      if (on) v5.play().catch(() => {}); else v5.pause();
    };
    new MutationObserver(sync).observe(p5, { attributes: true, attributeFilter: ["class"] });
    if ("IntersectionObserver" in window) new IntersectionObserver((en) => { inView = en[0].isIntersecting; sync(); }, { threshold: 0.25 }).observe(p5);
    sync();
  }
})();

// Download button at the bottom-right corner of every video (shown once the video is known to be loadable).
(() => {
  if (new URLSearchParams(location.search).get("capture")) return;
  const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
  document.querySelectorAll("video").forEach((v, i) => {
    const a = document.createElement("a");
    a.className = "vdl";
    a.innerHTML = ICON;
    a.title = "Download this video";
    a.setAttribute("aria-label", "Download this video");
    a.addEventListener("click", (e) => e.stopPropagation());
    const place = () => {
      const host = v.offsetParent;
      if (!host || v.readyState < 1) { a.hidden = true; return; }
      if (a.parentNode !== host) host.appendChild(a);
      const src = v.currentSrc || v.src;
      a.href = src;
      a.download = src.startsWith("data:") ? `opennavmap_clip_${i + 1}.mp4` : src.split("/").pop().split("?")[0];
      a.style.left = `${v.offsetLeft + v.offsetWidth - 42}px`;
      a.style.top = `${v.offsetTop + v.offsetHeight - 42}px`;
      a.hidden = false;
    };
    v.addEventListener("loadedmetadata", place);
    window.addEventListener("resize", place);
    if ("ResizeObserver" in window) new ResizeObserver(place).observe(v);
    place();
  });
})();

// P04a: the same real nodes under each of the three edge layers (data/p04a_layers.js). Steps are pure CSS on data-step-now:
// step 1 hides session B and the edges across sessions, step 2 shows everything.
(() => {
  const D = window.ONM_P04A, panel = document.getElementById("p04a");
  if (!D || !panel) return;
  const NS = "http://www.w3.org/2000/svg", W = 544, H = 490, PAD = 24;
  const k = Math.min((W - 2 * PAD) / D.size[0], (H - 2 * PAD) / D.size[1]);
  const ox = (W - k * D.size[0]) / 2, oy = (H - k * D.size[1]) / 2;
  const px = D.nodes.map(([x, y]) => [ox + k * x, H - oy - k * y]);
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([a, v]) => e.setAttribute(a, v));
    if (parent) parent.appendChild(e);
    return e;
  };
  const path = (edges) => edges.map(([a, b]) => `M${px[a][0].toFixed(1)} ${px[a][1].toFixed(1)}L${px[b][0].toFixed(1)} ${px[b][1].toFixed(1)}`).join("");
  panel.querySelectorAll(".p04a-col").forEach((col) => {
    const svg = col.querySelector(".p04a-map"), E = D.edges[col.dataset.layer] || [];
    const intra = (s) => E.filter(([a, , t]) => t === "intra" && D.nodes[a][2] === s);
    const cross = E.filter((e) => e[2] === "inter");
    el("path", { class: "p04a-intra", d: path(intra(1)) }, el("g", { class: "p04a-s1" }, svg));
    el("path", { class: "p04a-intra", d: path(intra(0)) }, el("g", {}, svg));
    const gx = el("g", { class: "p04a-cross" }, svg);
    el("path", { class: "p04a-halo", d: path(cross) }, gx);
    el("path", { class: "p04a-inter", d: path(cross) }, gx);
    const tag = document.createElement("div");
    tag.className = "p04a-cnt p04a-cross";
    tag.dataset.narrow = "hide";
    tag.style.cssText = "right:20px;top:502px";
    tag.textContent = `+${cross.length} edges across sessions`;
    col.appendChild(tag);
    [1, 0].forEach((s) => {
      const g = el("g", s ? { class: "p04a-s1" } : {}, svg);
      D.nodes.forEach((n, i) => { if (n[2] === s) el("circle", { class: "p04a-n" + s, cx: px[i][0].toFixed(1), cy: px[i][1].toFixed(1), r: s ? 4 : 4.5 }, g); });
    });
  });
  // a capture without ?step shows the final step
  const q = new URLSearchParams(location.search);
  if (q.get("capture") === "p04a" && !q.get("step")) panel.dataset.stepNow = "2";
})();
