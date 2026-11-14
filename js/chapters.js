"use strict";
// Scroll page, chapter view: panels with data-chapter="n" are grouped into chapters, and each chapter shows one panel at a
// time under a row of tabs (label: the panel's data-toc, or data-tab). Loaded before site.js, so every later script sees
// the final DOM. Never runs in present / speaker / capture mode. ?flat=1, or the "Show all pages" toggle (remembered in
// localStorage), keeps the long single scroll. Phones (< 700 px) and print show every panel, with chapter headings only;
// without JS the page is the long scroll.
(function () {
  const CHAPTERS = [
    ["Motivation", "Many casual recorders replace one survey, but joining their sessions is hard."],
    ["Map representation", "Images, poses and their relations form the map; local 3D is inferred on demand."],
    ["Results: Localization and map merging", "Localization links each new submap to the map; pose graph optimization merges it in."],
    ["Results: Visual Navigation", "From a goal image, the robot plans a path, localizes and follows it."],
    ["Outlook", "Two follow-up systems already use the map; the paper names four open directions."],
  ];
  // result chapters: every panel shown one under another, no tabs to click through
  const STACKED = new Set([3, 4]);
  const KEY = "onm-view";
  const html = document.documentElement;

  // highlight the nav link of the section under the reading line (40% down the screen), recomputed from
  // the scroll position on every scroll, so it cannot go stale; at the page end the last link wins
  function spyNav(nav, links, targets) {
    let cur = -1, queued = false;
    const update = () => {
      queued = false;
      if (html.dataset.mode !== "scroll") return;
      const line = Math.max(innerHeight * 0.4, 160);
      let k = -1;
      targets.forEach((t, i) => { const r = t.getBoundingClientRect(); if ((r.width || r.height) && r.top <= line) k = i; });
      if (scrollY + innerHeight >= html.scrollHeight - 2) k = targets.length - 1;
      if (k === cur) return;
      cur = k;
      links.forEach((a, i) => a.setAttribute("aria-current", String(i === k)));
      if (k >= 0 && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: links[k].offsetLeft - 16, behavior: "smooth" });
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener("scroll", ask, { passive: true });
    addEventListener("resize", ask);
    new MutationObserver(ask).observe(html, { attributes: true, attributeFilter: ["data-mode"] });
    if ("ResizeObserver" in window) new ResizeObserver(ask).observe(document.body);
    ask();
  }
  window.ONM_SPY_NAV = spyNav;

  const params = new URLSearchParams(location.search);
  if (["capture", "speaker", "present"].some((k) => params.get(k))) return;

  const store = (v) => { try { localStorage.setItem(KEY, v); return true; } catch (e) { return false; } };
  let flat = params.get("flat") === "1";
  if (!params.has("flat")) { try { flat = localStorage.getItem(KEY) === "flat"; } catch (e) { /* storage blocked: chapter view */ } }
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

  // the first panel on screen, so switching views keeps the reader's place
  const onScreen = () => [...document.querySelectorAll("#panels > .panel, .chap .panel")]
    .find((p) => { const r = p.getBoundingClientRect(); return r.height && r.bottom > 160; });
  const toggle = mk("button", "view-toggle", flat ? "Chapter view" : "Show all pages");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    const saved = store(flat ? "chapters" : "flat");
    const q = new URLSearchParams(location.search);
    q.delete("flat");
    if (!flat) q.set("flat", "1"); else if (!saved) q.set("flat", "0");
    const p = onScreen();
    const url = location.pathname + (String(q) ? "?" + q : "") + (p ? "#" + p.id : location.hash);
    if (url === location.pathname + location.search + location.hash) location.reload(); else location.href = url;
  });
  const tocWrap = document.querySelector(".toc .wrap");
  if (tocWrap) tocWrap.appendChild(toggle);
  if (flat) return;

  html.dataset.view = "chapters";
  const narrow = matchMedia("(max-width: 699.98px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const all = [...document.querySelectorAll(".panel[data-chapter]")];
  const chapters = [];
  CHAPTERS.forEach(([name, take], i) => {
    const n = i + 1, panels = all.filter((p) => p.dataset.chapter === String(n));
    if (!panels.length) return;
    const sec = mk("section", "chap"), head = mk("header", "chap-head"), body = mk("div", "chap-body"), foot = mk("div", "chap-foot");
    sec.id = "ch" + n;
    sec.setAttribute("aria-labelledby", `ch${n}-title`);
    head.appendChild(mk("div", "chap-num", "Chapter " + n));
    const h = head.appendChild(mk("h2", "chap-title", name));
    h.id = `ch${n}-title`;
    head.appendChild(mk("p", "chap-take", take));
    const list = head.appendChild(mk("div", "chap-tabs"));
    list.setAttribute("aria-label", name);
    const pos = foot.appendChild(mk("span", "chap-pos"));
    const prev = foot.appendChild(mk("button", "chap-step", "‹ Previous"));
    const next = foot.appendChild(mk("button", "chap-step", "Next ›"));
    const ch = { n, sec, body, list, pos, prev, next, panels, tabs: [], cur: 0, stacked: STACKED.has(n) };
    sec.classList.toggle("stacked", ch.stacked);
    panels.forEach((p, k) => {
      const t = list.appendChild(mk("button", "chap-tab"));
      t.append(mk("span", "chap-tab-num", n + "." + (k + 1)), p.dataset.toc || p.dataset.tab || p.id);
      t.type = "button";
      t.id = "tab-" + p.id;
      t.setAttribute("aria-controls", p.id);
      t.addEventListener("click", () => select(ch, k));
      ch.tabs.push(t);
      // eyebrow: chapter.page, matching the tab position
      const eb = p.querySelector(":scope > .eyebrow");
      if (eb) {
        let s = eb.querySelector(":scope > span:first-child");
        if (!s) { s = mk("span"); eb.prepend(s, " / "); }
        s.textContent = n + "." + (k + 1);
      }
    });
    [prev, next].forEach((b, d) => {
      b.type = "button";
      b.setAttribute("aria-label", d ? "Next page" : "Previous page");
      b.addEventListener("click", () => {
        select(ch, ch.cur + (d ? 1 : -1));
        // the tab row is above the screen: bring it back, so the reader sees which page is open
        if (list.getBoundingClientRect().top < 0) sec.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      });
    });
    list.addEventListener("keydown", (e) => {
      const k = { ArrowRight: ch.cur + 1, ArrowLeft: ch.cur - 1, Home: 0, End: panels.length - 1 }[e.key];
      if (k === undefined) return;
      e.preventDefault();
      select(ch, (k + panels.length) % panels.length);
      ch.tabs[ch.cur].focus();
    });
    panels[0].before(sec);
    sec.append(head, body, foot);
    panels.forEach((p) => body.appendChild(p));
    chapters.push(ch);
    select(ch, 0, { quiet: true });
  });
  const cite = document.querySelector(".cite > .eyebrow");
  if (cite) cite.textContent = "Cite";

  // tabs only where they fit; phones get every panel with the chapter headings
  function layout() {
    chapters.forEach((ch) => {
      const tabs = !narrow.matches && !ch.stacked;
      ch.list.toggleAttribute("hidden", !tabs);
      ch.list.setAttribute("role", tabs ? "tablist" : "presentation");
      ch.tabs.forEach((t) => t.setAttribute("role", tabs ? "tab" : "presentation"));
      ch.panels.forEach((p) => {
        if (tabs) { p.setAttribute("role", "tabpanel"); p.setAttribute("aria-labelledby", "tab-" + p.id); }
        else { p.removeAttribute("role"); p.removeAttribute("aria-labelledby"); }
      });
    });
  }
  layout();
  narrow.addEventListener("change", layout);

  // the tab row stays where it is on screen. opts.quiet: start-up, before any player exists (classes and labels only);
  // opts.instant: no height / fade animation
  function select(ch, k, opts = {}) {
    k = Math.max(0, Math.min(ch.panels.length - 1, k));
    const old = ch.panels[ch.cur], neu = ch.panels[k];
    const y0 = ch.list.getBoundingClientRect().top, h0 = ch.body.offsetHeight;
    ch.cur = k;
    ch.panels.forEach((p, i) => p.classList.toggle("tab-off", !ch.stacked && i !== k));
    ch.tabs.forEach((t, i) => { t.setAttribute("aria-selected", String(i === k)); t.tabIndex = i === k ? 0 : -1; });
    ch.pos.textContent = (k + 1) + " / " + ch.panels.length;
    ch.prev.disabled = k === 0;
    ch.next.disabled = k === ch.panels.length - 1;
    if (opts.quiet || old === neu || ch.stacked) return;
    const pl = window.ONM_PLAYERS || {};
    if (pl[old.id] && pl[old.id].pause) pl[old.id].pause();
    old.querySelectorAll("video").forEach((v) => v.pause());
    const dy = ch.list.getBoundingClientRect().top - y0;
    if (dy) window.scrollBy({ top: dy, behavior: "instant" });
    if (!reduced && !narrow.matches && !opts.instant) {
      const h1 = ch.body.offsetHeight;
      if (h1 !== h0) {
        ch.body.style.overflow = "hidden";
        ch.body.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 260, easing: "ease-out" })
          .finished.then(() => { ch.body.style.overflow = ""; }, () => { ch.body.style.overflow = ""; });
      }
      neu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    }
    history.replaceState(null, "", location.pathname + location.search + "#" + neu.id);
    // canvases drawn while hidden measured a zero-size layout
    if (pl[neu.id] && pl[neu.id].redraw && !pl[neu.id].playing) pl[neu.id].redraw();
    neu.dispatchEvent(new CustomEvent("onm-shown", { bubbles: true }));
  }

  const find = (id) => {
    for (const ch of chapters) { const k = ch.panels.findIndex((p) => p.id === id); if (k >= 0) return [ch, k]; }
    return null;
  };
  // open the tab of #id; scroll to its chapter unless the browser already shows every panel (phones)
  function openHash(scroll) {
    const f = find(location.hash.slice(1));
    if (!f) return;
    select(f[0], f[1], { quiet: !window.ONM_PLAYERS, instant: true });
    if (scroll && !narrow.matches) requestAnimationFrame(() => (f[0].stacked ? f[0].panels[f[1]] : f[0].sec).scrollIntoView());
  }
  openHash(false);
  if (find(location.hash.slice(1))) window.addEventListener("load", () => openHash(true), { once: true });
  window.addEventListener("hashchange", () => { if (html.dataset.mode === "scroll") openHash(true); });
  // back from presenting: site.js wrote the slide's id into the hash and scrolls to it next frame; open its tab first
  let mode = html.dataset.mode;
  new MutationObserver(() => {
    if (html.dataset.mode === "scroll" && mode !== "scroll") openHash(true);
    mode = html.dataset.mode;
  }).observe(html, { attributes: true, attributeFilter: ["data-mode"] });

  // sticky nav: the chapters plus Cite, the one in the middle of the screen highlighted
  const nav = document.querySelector(".toc-links");
  if (nav) {
    const items = chapters.map((ch) => [ch.sec, CHAPTERS[ch.n - 1][0], ch.n]);
    const citeSec = document.getElementById("cite");
    if (citeSec) items.push([citeSec, "Cite", 0]);
    const links = items.map(([sec, name, n]) => {
      const a = nav.appendChild(mk("a"));
      a.href = "#" + sec.id;
      if (n) a.appendChild(mk("span", "n", String(n)));
      a.appendChild(document.createTextNode(name));
      return a;
    });
    if (window.ONM_SPY_NAV) window.ONM_SPY_NAV(nav, links, items.map(([sec]) => sec));
  }

  // test hook for headless checks: show the tab holding #id, without scrolling or animation
  window.ONM_REVEAL = (id) => { const f = find(id); if (f) select(f[0], f[1], { quiet: !window.ONM_PLAYERS, instant: true }); return !!f; };
})();
