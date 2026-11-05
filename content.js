// Noted — content script
// Draws notes on the page, saves them to chrome.storage.local, and brings
// them back when you return. Each note lives in its own shadow root so the
// website's CSS can't mess with it (and ours can't mess with the site).

(() => {
  // Only one copy of Noted runs on a page. After an update, Chrome cuts the
  // old copy off from the extension; the new copy takes over from it here.
  const me = {};
  window.__notedInstance = me;
  const alive = () => window.__notedInstance === me && !!(chrome.runtime && chrome.runtime.id);
  document.querySelectorAll("#sticky-notes-ext-root").forEach((el) => el.remove());

  // ---------- colors ----------
  // Soft pastel palette. The tape, text and icon colors are worked out from
  // the paper color, so custom colors look right too.
  const COLORS = {
    yellow:     "#FEEFB9",
    apricot:    "#FEDFC3",
    pink:       "#FED1DD",
    lilac:      "#EEDAF8",
    periwinkle: "#E0DBFB",
    sky:        "#D3E9FE",
    aqua:       "#D3F4F4",
    mint:       "#D3ECDC"
  };
  // Colors from earlier versions, so old notes keep their look.
  const LEGACY = {
    peach: "#FFD3A8", coral: "#FFB3A7", lavender: "#DCCBFF", purple: "#DCCBFF",
    blue: "#BFE3FF", green: "#C8F0C2", lime: "#E4F5A6", sand: "#EADFCB",
    white: "#FFFFFF", charcoal: "#3A3A42"
  };
  const DEFAULT_COLOR = "yellow";
  const DEFAULT_W = 230;
  const DEFAULT_H = 190;
  const KEY_PREFIX = "note:";
  const FONT = "StickyNotesUrbanist";

  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > .5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${clamp(s).toFixed(0)}% ${clamp(l).toFixed(0)}%)`;

  function paletteFor(color) {
    const bg = /^#[0-9a-f]{6}$/i.test(color) ? color : (COLORS[color] || LEGACY[color] || COLORS[DEFAULT_COLOR]);
    const [h, s, l] = hexToHsl(bg);
    const n = parseInt(bg.slice(1), 16);
    const lum = 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255);
    const dark = lum < 140;
    const grey = s < 8;
    return {
      bg,
      ink: dark ? hsl(h, s * .3, 95) : hsl(h, Math.min(s, 20), 11),
      pin: grey ? hsl(0, 0, dark ? 70 : 42) : hsl(h, Math.min(s * .55, 52), dark ? l + 25 : l - 34),
      pinDark: grey ? hsl(0, 0, dark ? 55 : 30) : hsl(h, Math.min(s * .5, 46), dark ? l + 12 : l - 46)
    };
  }

  // ---------- font ----------
  // Fetched as bytes (not a URL) so websites' security rules can't block it.
  [400, 500, 600, 700].forEach(async (w) => {
    try {
      const buf = await (await fetch(chrome.runtime.getURL(`fonts/Urbanist-${w}.woff2`))).arrayBuffer();
      const face = new FontFace(FONT, buf, { weight: String(w) });
      await face.load();
      document.fonts.add(face);
    } catch {}
  });

  // ---------- hand-cut paper shape ----------
  // Each note gets its own slightly wobbly outline, seeded by its id so it
  // stays the same every time you come back.
  function rng(seedStr) {
    let a = 0;
    for (const ch of seedStr) a = (a * 31 + ch.charCodeAt(0)) | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function paperPath(id) {
    const r = rng(id);
    const j = (amt) => (r() * 2 - 1) * amt;      // jitter
    const ins = () => r() * .9;                   // corner inset
    const TL = [ins(), ins()], TR = [100 - ins(), ins()];
    const BR = [100 - ins(), 100 - ins()], BL = [ins(), 100 - ins()];
    const rx = 2.2, ry = 2.6;
    const f = (n) => n.toFixed(2);
    return [
      `M${f(TL[0] + rx)},${f(TL[1])}`,
      `C${f(33)},${f(TL[1] + j(1.1))} ${f(66)},${f(TR[1] + j(1.1))} ${f(TR[0] - rx)},${f(TR[1])}`,
      `Q${f(TR[0])},${f(TR[1])} ${f(TR[0])},${f(TR[1] + ry)}`,
      `C${f(TR[0] + j(.9))},${f(33)} ${f(BR[0] + j(.9))},${f(66)} ${f(BR[0])},${f(BR[1] - ry)}`,
      `Q${f(BR[0])},${f(BR[1])} ${f(BR[0] - rx)},${f(BR[1])}`,
      `C${f(66)},${f(BR[1] + j(1.1))} ${f(33)},${f(BL[1] + j(1.1))} ${f(BL[0] + rx)},${f(BL[1])}`,
      `Q${f(BL[0])},${f(BL[1])} ${f(BL[0])},${f(BL[1] - ry)}`,
      `C${f(BL[0] + j(.9))},${f(66)} ${f(TL[0] + j(.9))},${f(33)} ${f(TL[0])},${f(TL[1] + ry)}`,
      `Q${f(TL[0])},${f(TL[1])} ${f(TL[0] + rx)},${f(TL[1])}Z`
    ].join(" ");
  }

  // ---------- page root ----------
  // Absolutely positioned at the top-left of the document, so notes placed
  // with page coordinates scroll along with the content.
  const root = document.createElement("div");
  root.id = "sticky-notes-ext-root";
  Object.assign(root.style, {
    position: "absolute", top: "0", left: "0", width: "0", height: "0",
    overflow: "visible", zIndex: "2147483646", pointerEvents: "none"
  });
  document.documentElement.appendChild(root);
  // Some sites rebuild the page after it loads and wipe out anything they
  // didn't put there. Put the notes back if that happens.
  new MutationObserver(() => {
    if (!root.isConnected && alive()) document.documentElement.appendChild(root);
  }).observe(document.documentElement, { childList: true });

  const rendered = new Map(); // id -> { host, note, els }
  let lastContext = null;
  let currentHref = location.href;

  document.addEventListener("contextmenu", (e) => {
    lastContext = { x: e.pageX, y: e.pageY };
  }, true);

  // ---------- location helpers ----------
  const pagePath = () => location.pathname + location.search;

  // ---------- matching a note to a page ----------
  // The same page often comes back with a slightly different address: Google
  // adds ?srsltid=… to search results, links add utm_ tracking, sites add or
  // drop "www." or a trailing slash. None of that should hide a note.
  const TRACKING = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|igshid|srsltid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|ref_url|si|spm|ved|ei|s_kwcid|li_fat_id)$/i;
  const hostOf = (origin) => {
    try { return new URL(origin).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return String(origin); }
  };
  const cleanPath = (p) => {
    p = p.replace(/\/(index|default)\.(html?|php|aspx?)$/i, "/");
    return p.length > 1 ? p.replace(/\/+$/, "") : p;
  };
  const params = (search) => {
    const out = new Map();
    new URLSearchParams(search).forEach((v, k) => { if (!TRACKING.test(k)) out.set(k, v); });
    return out;
  };
  function samePage(noteOrigin, notePath, url) {
    if (hostOf(noteOrigin) !== hostOf(url.origin)) return false;
    const n = new URL(notePath || "/", "http://x");
    if (cleanPath(n.pathname) !== cleanPath(url.pathname)) return false;
    // A setting that's on both addresses must agree (so different videos or
    // documents stay separate). Settings only one address has don't matter.
    const a = params(n.search), b = params(url.search);
    for (const [k, v] of a) if (b.has(k) && b.get(k) !== v) return false;
    return true;
  }
  const matchesHere = (n) =>
    n.scope === "site" ? hostOf(n.origin) === hostOf(location.origin) : samePage(n.origin, n.path, location);

  // ---------- storage ----------
  async function loadAll() {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith(KEY_PREFIX))
      .map(([, v]) => v);
  }
  const deletedIds = new Set();
  const save = (note) => {
    if (note.deleted || deletedIds.has(note.id)) return;
    note.updated = Date.now();
    return chrome.storage.local.set({ [KEY_PREFIX + note.id]: note });
  };
  const remove = (id) => chrome.storage.local.remove(KEY_PREFIX + id);

  // ---------- creating ----------
  async function createNote(x, y, text = "") {
    const { lastColor } = await chrome.storage.local.get("lastColor");
    const maxX = document.documentElement.scrollWidth - DEFAULT_W - 8;
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text,
      color: lastColor || DEFAULT_COLOR,
      scope: "page",
      origin: location.origin,
      path: pagePath(),
      url: location.href,
      title: document.title || location.hostname,
      x: Math.max(8, Math.min(x, maxX > 8 ? maxX : x)),
      y: Math.max(16, y),
      w: DEFAULT_W,
      h: DEFAULT_H,
      created: Date.now(),
      updated: Date.now()
    };
    save(note);
    render(note, true);
  }

  // ---------- icons ----------
  const ICON = {
    page: '<svg viewBox="0 0 16 16"><path d="M4.5 2.5h4.8l2.2 2.2v8.8h-7z M9.2 2.6v2.2h2.2"/></svg>',
    site: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M2.6 8h10.8M8 2.5c-1.8 1.6-1.8 9.4 0 11M8 2.5c1.8 1.6 1.8 9.4 0 11"/></svg>',
    min: '<svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg>',
    restore: '<svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>',
    del: '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
  };

  // ---------- rendering ----------
  function render(note, focus = false) {
    if (rendered.has(note.id)) return;

    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "absolute", left: note.x + "px", top: note.y + "px",
      pointerEvents: "auto"
    });
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="wrap">
        <svg class="paper" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="${paperPath(note.id)}"/>
        </svg>
        <div class="tape" title="Drag to move" aria-hidden="true"
             style="--tilt:${(() => { const r = rng(note.id + "tape"); return ((r() < .5 ? -1 : 1) * (2 + r() * 3)).toFixed(1); })()}deg"></div>
        <div class="note">
          <div class="bar" title="Drag to move">
            <button class="scope" title=""></button>
            <span class="grab"></span>
            <div class="actions">
              <button class="icon palette-btn" title="Color" aria-label="Change color"><span class="dot"></span></button>
              <button class="icon min-btn" title="Minimize" aria-label="Minimize"></button>
              <button class="icon del-btn" title="Delete note" aria-label="Delete note">${ICON.del}</button>
            </div>
          </div>
          <div class="palette" hidden>
            ${Object.keys(COLORS).map(c =>
              `<button class="swatch" data-color="${c}" title="${c}" aria-label="${c}" style="background:${COLORS[c]}"></button>`
            ).join("")}
            <label class="swatch custom" title="Custom color" aria-label="Custom color">
              <input type="color" class="custom-input">
            </label>
          </div>
          <div class="confirm" hidden>
            <span>Delete this note?</span>
            <button class="no">Keep</button>
            <button class="yes">Delete</button>
          </div>
          <textarea placeholder="Write a note…" spellcheck="true"></textarea>
          <span class="corner" aria-hidden="true"></span>
        </div>
      </div>`;

    const els = {
      wrap: shadow.querySelector(".wrap"),
      tape: shadow.querySelector(".tape"),
      note: shadow.querySelector(".note"),
      bar: shadow.querySelector(".bar"),
      scope: shadow.querySelector(".scope"),
      paletteBtn: shadow.querySelector(".palette-btn"),
      palette: shadow.querySelector(".palette"),
      minBtn: shadow.querySelector(".min-btn"),
      delBtn: shadow.querySelector(".del-btn"),
      confirm: shadow.querySelector(".confirm"),
      text: shadow.querySelector("textarea"),
      custom: shadow.querySelector(".custom-input")
    };

    els.note.style.width = note.w + "px";
    els.note.style.height = note.h + "px";
    els.text.value = note.text;
    applyColor(els, note.color);
    applyScope(els, note.scope);
    applyMin(els, note.minimized);

    // Keep keystrokes inside the note (some sites have global shortcuts).
    ["keydown", "keyup", "keypress"].forEach((t) =>
      els.text.addEventListener(t, (e) => e.stopPropagation())
    );

    // Text — saved on every keystroke, so closing the tab right after
    // typing never loses anything.
    let t;
    els.text.addEventListener("input", () => {
      note.text = els.text.value;
      save(note);
    });

    // Color
    els.paletteBtn.addEventListener("click", () => {
      els.palette.hidden = !els.palette.hidden;
      els.confirm.hidden = true;
    });
    els.palette.addEventListener("click", (e) => {
      const c = e.target.dataset && e.target.dataset.color;
      if (!c) return;
      setColor(c);
      els.palette.hidden = true;
    });
    els.custom.addEventListener("input", () => {
      note.color = els.custom.value;
      applyColor(els, note.color);
    });
    els.custom.addEventListener("change", () => setColor(els.custom.value));
    function setColor(c) {
      note.color = c;
      applyColor(els, c);
      save(note);
      chrome.storage.local.set({ lastColor: c }); // new notes start in this color
    }

    // Scope: this page <-> whole site
    els.scope.addEventListener("click", () => {
      note.scope = note.scope === "page" ? "site" : "page";
      if (note.scope === "page") { note.path = pagePath(); note.url = location.href; }
      applyScope(els, note.scope);
      save(note);
    });

    // Minimize
    els.minBtn.addEventListener("click", () => {
      note.minimized = !note.minimized;
      applyMin(els, note.minimized);
      save(note);
    });

    // Delete (with a quick confirm if the note has text)
    els.delBtn.addEventListener("click", () => {
      if (!note.text.trim()) return destroy(note.id, true);
      els.palette.hidden = true;
      els.confirm.hidden = false;
    });
    els.confirm.querySelector(".yes").addEventListener("click", () => destroy(note.id, true));
    els.confirm.querySelector(".no").addEventListener("click", () => { els.confirm.hidden = true; });

    // Drag by the top row or the tape
    const startDrag = (handle) => (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.pageX, startY = e.pageY, ox = note.x, oy = note.y;
      els.wrap.classList.add("dragging");
      const move = (ev) => {
        note.x = Math.max(0, ox + ev.pageX - startX);
        note.y = Math.max(12, oy + ev.pageY - startY);
        host.style.left = note.x + "px";
        host.style.top = note.y + "px";
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        els.wrap.classList.remove("dragging");
        save(note);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    };
    els.bar.addEventListener("pointerdown", startDrag(els.bar));
    els.tape.addEventListener("pointerdown", startDrag(els.tape));

    // Resize (bottom-right corner) — save the new size
    let rt;
    const ro = new ResizeObserver(() => {
      if (note.minimized || note.deleted || !host.isConnected) return;
      const w = Math.round(els.note.offsetWidth), h = Math.round(els.note.offsetHeight);
      if (w === note.w && h === note.h) return;
      note.w = w; note.h = h;
      clearTimeout(rt);
      rt = setTimeout(() => save(note), 300);
    });
    ro.observe(els.note);

    root.appendChild(host);
    rendered.set(note.id, { host, note, els, ro,
      stopTimers: () => { clearTimeout(t); clearTimeout(rt); },
      flush: () => { if (rt) { clearTimeout(rt); rt = null; save(note); } } });

    if (focus) {
      els.wrap.classList.add("pop");
      setTimeout(() => els.text.focus(), 30);
    }
  }

  function applyColor(els, color) {
    const c = paletteFor(color);
    const s = els.wrap.style;
    s.setProperty("--bg", c.bg);
    s.setProperty("--ink", c.ink);
    s.setProperty("--pin", c.pin);
    s.setProperty("--pin-dark", c.pinDark);
    const custom = /^#/.test(color);
    els.palette.querySelectorAll(".swatch").forEach((sw) => {
      sw.classList.toggle("on", sw.classList.contains("custom") ? custom : sw.dataset.color === color);
    });
    els.custom.value = c.bg.toLowerCase();
  }
  function applyScope(els, scope) {
    const site = scope === "site";
    els.scope.innerHTML = (site ? ICON.site : ICON.page) + `<span>${site ? "Whole site" : "This page"}</span>`;
    els.scope.title = site
      ? "Shows on every page of " + location.hostname + " — click to keep it on this page only"
      : "Shows on this page only — click to show it across " + location.hostname;
  }
  function applyMin(els, min) {
    els.note.classList.toggle("min", !!min);
    els.minBtn.innerHTML = min ? ICON.restore : ICON.min;
    els.minBtn.title = min ? "Expand" : "Minimize";
    els.minBtn.setAttribute("aria-label", els.minBtn.title);
  }

  function destroy(id, alsoDelete) {
    const r = rendered.get(id);
    if (alsoDelete) {
      deletedIds.add(id);
      if (r) r.note.deleted = true;
    }
    if (r) {
      r.stopTimers();      // cancel any pending save
      r.ro.disconnect();   // stop watching size before removing
      r.host.remove();
      rendered.delete(id);
    }
    if (alsoDelete) remove(id);
  }

  async function refresh() {
    const notes = (await loadAll()).filter(matchesHere);
    const keep = new Set(notes.map((n) => n.id));
    for (const id of [...rendered.keys()]) if (!keep.has(id)) destroy(id, false);
    notes.forEach((n) => render(n));
  }

  // ---------- messages from popup / background ----------
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!alive()) return;
    if (msg.type === "add-note") {
      if (msg.at === "context" && lastContext) {
        createNote(lastContext.x, lastContext.y, msg.selection || "");
      } else {
        const step = (rendered.size % 6) * 36;
        createNote(
          window.scrollX + window.innerWidth - DEFAULT_W - 40 - step,
          window.scrollY + 80 + step,
          msg.selection || ""
        );
      }
      reply({ ok: true });
    } else if (msg.type === "count") {
      reply({ ok: true, count: rendered.size });
    } else if (msg.type === "scroll-to") {
      const r = rendered.get(msg.id);
      if (r) {
        window.scrollTo({ top: Math.max(0, r.note.y - 120), behavior: "smooth" });
        r.els.wrap.classList.remove("pop"); void r.els.wrap.offsetWidth;
        r.els.wrap.classList.add("pop");
      }
      reply({ ok: !!r });
    }
  });

  // Other tabs (or the popup's list) may delete or add notes — stay in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !alive()) return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const id = key.slice(KEY_PREFIX.length);
      if (!newValue) { destroy(id, false); continue; }
      if (deletedIds.has(id)) continue;
      const r = rendered.get(id);
      if (!matchesHere(newValue)) { if (r) destroy(id, false); continue; }
      if (!r) { render(newValue); continue; }
      // Update a note changed elsewhere, unless you're typing in it here.
      if (r.els.text !== r.host.shadowRoot.activeElement) {
        Object.assign(r.note, newValue);
        r.els.text.value = newValue.text;
        applyColor(r.els, newValue.color);
        applyScope(r.els, newValue.scope);
        applyMin(r.els, newValue.minimized);
      }
    }
  });

  // Single-page apps change the URL without reloading — watch for it.
  const watch = setInterval(() => {
    if (!alive()) { clearInterval(watch); return; }   // a newer copy took over
    if (location.href !== currentHref) { currentHref = location.href; refresh(); }
  }, 800);

  // Leaving the page: save anything still waiting (like a resize).
  window.addEventListener("pagehide", () => {
    if (alive()) rendered.forEach((r) => r.flush());
  });

  refresh();

  // ---------- styles (inside each shadow root) ----------
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .wrap {
      --bg: #FEEFB9; --ink: #3D3418; --pin: #C9A227; --pin-dark: #8F7210;
      --soft: color-mix(in srgb, var(--ink) 55%, transparent);
      --line: color-mix(in srgb, var(--ink) 12%, transparent);
      position: relative; display: inline-block;
      color: var(--ink);
      font: 500 15px/1.45 ${FONT}, "Urbanist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transform-origin: 50% 0;
    }
    .wrap.pop { animation: pop .32s cubic-bezier(.2,1.4,.4,1); }
    @keyframes pop { from { transform: translateY(-6px) scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }

    /* Paper */
    .paper {
      position: absolute; inset: 0; width: 100%; height: 100%;
      overflow: visible; pointer-events: none;
      filter: drop-shadow(0 1px 1px rgba(0,0,0,.08)) drop-shadow(0 6px 12px rgba(0,0,0,.10));
      transition: filter .15s;
    }
    .paper path { fill: var(--bg); }
    .wrap.dragging .paper { filter: drop-shadow(0 2px 3px rgba(0,0,0,.10)) drop-shadow(0 16px 28px rgba(0,0,0,.18)); }

    /* Tape — see-through strip with torn ends, tilted a little differently on each note */
    .tape {
      position: absolute; z-index: 3; top: -9px; left: 50%;
      width: 66px; height: 20px; margin-left: -33px;
      background: color-mix(in srgb, color-mix(in srgb, var(--pin) 55%, #fff) 55%, transparent);
      transform: rotate(var(--tilt, -2deg));
      clip-path: polygon(
        0% 6%, 4% 0%, 96% 0%, 100% 8%, 97% 24%, 100% 40%, 96% 56%, 100% 72%, 97% 88%, 100% 100%,
        4% 100%, 0% 92%, 3% 76%, 0% 60%, 3% 44%, 0% 28%, 3% 14%
      );
      cursor: grab; touch-action: none;
      transition: transform .15s;
    }
    .wrap.dragging .tape { transform: rotate(var(--tilt, -2deg)) translateY(-2px); cursor: grabbing; }

    /* Note body */
    .note {
      position: relative; z-index: 1;
      display: flex; flex-direction: column;
      min-width: 210px; min-height: 120px; max-width: 640px; max-height: 640px;
      resize: both; overflow: hidden;
    }
    .note::-webkit-resizer { background: transparent; }
    .corner {
      position: absolute; right: 6px; bottom: 6px; width: 10px; height: 10px;
      pointer-events: none; opacity: .35;
      background:
        linear-gradient(135deg, transparent 45%, var(--ink) 45%, var(--ink) 55%, transparent 55%) 4px 4px / 6px 6px no-repeat,
        linear-gradient(135deg, transparent 47%, var(--ink) 47%, var(--ink) 53%, transparent 53%) 0 0 / 10px 10px no-repeat;
    }
    .note.min { height: auto !important; min-height: 0; resize: none; }
    .note.min textarea, .note.min .palette, .note.min .confirm, .note.min .corner { display: none; }
    .note.min .bar { padding-bottom: 8px; }

    /* Top row — always visible, kept quiet */
    .bar {
      display: flex; align-items: center; gap: 0;
      padding: 10px 8px 0 10px; flex-shrink: 0;
      cursor: grab; user-select: none; touch-action: none;
    }
    .wrap.dragging .bar { cursor: grabbing; }
    .grab { flex: 1 1 0; align-self: stretch; min-width: 8px; }
    .actions { display: flex; align-items: center; flex: 0 0 auto; margin-left: auto; }
    button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; }
    button:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

    .scope {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 12px; font-weight: 600; letter-spacing: .01em;
      color: var(--soft); padding: 3px 6px 3px 3px; border-radius: 6px;
      white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden;
    }
    .scope svg { flex-shrink: 0; }
    .scope span { overflow: hidden; text-overflow: ellipsis; }
    .scope svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
    .scope:hover { color: var(--ink); background: var(--line); }

    .icon {
      width: 26px; height: 26px; border-radius: 7px;
      display: grid; place-items: center; color: var(--soft);
    }
    .icon:hover { color: var(--ink); background: var(--line); }
    .icon svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .dot {
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--pin);
    }

    /* Color menu */
    .palette {
      display: grid; grid-template-columns: repeat(auto-fill, 22px); gap: 8px;
      margin: 8px 12px 0; padding: 10px 0; flex-shrink: 0;
      border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    }
    .palette[hidden], .confirm[hidden] { display: none; }
    .swatch {
      width: 22px; height: 22px; border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.10);
      transition: transform .12s;
    }
    .swatch:hover { transform: scale(1.12); }
    .swatch.on { box-shadow: inset 0 0 0 1px rgba(0,0,0,.10), 0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink); }
    .swatch.custom {
      position: relative; cursor: pointer; display: block;
      background: conic-gradient(#FED1DD, #FEDFC3, #FEEFB9, #D3ECDC, #D3F4F4, #D3E9FE, #E0DBFB, #EEDAF8, #FED1DD);
    }
    .custom-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }

    /* Delete confirm */
    .confirm {
      display: flex; align-items: center; gap: 6px;
      margin: 8px 12px 0; padding: 8px 0; flex-shrink: 0;
      font-size: 13px; font-weight: 600;
      border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    }
    .confirm span { flex: 1; }
    .confirm button { padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .confirm .yes { background: var(--ink); color: var(--bg); }
    .confirm .no { background: var(--line); }

    /* Writing area */
    textarea {
      flex: 1; width: 100%; resize: none; border: 0; outline: 0;
      background: transparent; color: inherit; font: inherit;
      padding: 8px 16px 18px; margin: 0;
    }
    textarea::placeholder { color: currentColor; opacity: .4; }
    textarea::selection { background: color-mix(in srgb, var(--pin) 40%, transparent); }
  `;
})();
