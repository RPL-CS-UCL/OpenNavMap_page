"use strict";
// Round 4, talk helpers: the hook clip plays while its slide is shown; section numbers follow the page order.
(function () {
  const hook = document.getElementById("hook");
  const video = hook && hook.querySelector("video");
  if (video) {
    let was = false;
    new MutationObserver(() => {
      const on = hook.classList.contains("is-current") && document.documentElement.dataset.mode === "present";
      if (on && !was) { video.currentTime = 0; video.play().catch(() => {}); }
      if (!on && was) video.pause();
      was = on;
    }).observe(hook, { attributes: true, attributeFilter: ["class"] });
  }
  // hook map: tilted view of a real map graph (data/hook_map.js from render/build_hook_map.py)
  const host = document.getElementById("hook-map"), M = window.ONM_HOOK;
  if (host && M) {
    const N = M.nodes, ns = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const svg = mk("svg", { viewBox: `0 0 ${M.box[0]} ${M.box[1]}`, width: M.box[0], height: M.box[1], "aria-hidden": "true" });
    svg.appendChild(mk("polygon", { class: "hm-sheet", points: M.sheet.map((q) => q.join(",")).join(" ") }));
    svg.appendChild(mk("path", { class: "hm-edge", d: M.edges.map(([a, b]) => `M${N[a][0]} ${N[a][1]}L${N[b][0]} ${N[b][1]}`).join("") }));
    const nodes = mk("g", {});
    N.forEach(([x, y]) => nodes.appendChild(mk("circle", { class: "hm-node", cx: x, cy: y, r: 1.6 })));
    svg.appendChild(nodes);
    svg.appendChild(mk("path", { class: "hm-route", d: "M" + M.route.map((i) => N[i].join(" ")).join("L") }));
    M.thumbs.forEach((t) => svg.appendChild(mk("line", { class: "hm-stem", x1: t.p[0], y1: t.p[1], x2: t.p[0], y2: t.p[1] - M.stem })));
    const [s, g] = [N[M.route[0]], N[M.route[M.route.length - 1]]];
    svg.appendChild(mk("circle", { class: "hm-end hm-start", cx: s[0], cy: s[1], r: 8 }));
    svg.appendChild(mk("circle", { class: "hm-end hm-goal", cx: g[0], cy: g[1], r: 9 }));
    const txt = (x, y, str, anchor) => { const e = mk("text", { class: "hm-txt", x, y, "text-anchor": anchor }); e.textContent = str; svg.appendChild(e); };
    txt(s[0] - 16, s[1] + 6, "start", "end");
    txt(g[0] + 16, g[1] + 6, "goal", "start");
    host.appendChild(svg);
    M.thumbs.forEach((t, i) => {
      const im = document.createElement("img");
      im.className = "hm-thumb" + (i === M.thumbs.length - 1 ? " goal" : "");
      im.src = t.src; im.alt = ""; im.width = 112; im.height = 63;
      im.style.left = (t.p[0] - 56) + "px"; im.style.top = (t.p[1] - M.stem - 63) + "px";
      host.appendChild(im);
    });
  }
  let n = 0;
  // chapter view: js/chapters.js numbers them chapter.page
  if (document.documentElement.dataset.view !== "chapters") document.querySelectorAll(".panel > .eyebrow > span:first-child, .cite > .eyebrow > span:first-child").forEach((s) => {
    n += 1;
    s.textContent = String(n).padStart(2, "0");
  });
})();
