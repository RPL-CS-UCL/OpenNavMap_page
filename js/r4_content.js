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
})();
