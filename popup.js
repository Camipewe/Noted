// Noted — popup
// "This page" lists the notes on the site you're on.
// "All notes" lists every note, grouped by when you last edited it.

const COLORS = {
  yellow: "#FEEFB9", apricot: "#FEDFC3", pink: "#FED1DD", lilac: "#EEDAF8",
  periwinkle: "#E0DBFB", sky: "#D3E9FE", aqua: "#D3F4F4", mint: "#D3ECDC",
  // older colors
  peach: "#FFD3A8", coral: "#FFB3A7", lavender: "#DCCBFF", purple: "#DCCBFF", blue: "#BFE3FF",
  green: "#C8F0C2", lime: "#E4F5A6", sand: "#EADFCB", white: "#FFFFFF", charcoal: "#3A3A42"
};
const colorOf = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : COLORS[c] || COLORS.yellow);
const $ = (s) => document.querySelector(s);

let activeTab;
let here = null;        // URL of the current tab
let tab = "page";       // which tab is showing
let notes = [];

init();

async function init() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { here = new URL(activeTab.url); } catch {}

  // Show the shortcut the user actually has set (they can change it).
  chrome.commands.getAll((cmds) => {
    const c = cmds.find((x) => x.name === "add-note");
    const k = $("#shortcut");
    if (c && c.shortcut) k.textContent = prettyKeys(c.shortcut);
    else k.hidden = true;
  });

  // Can we add notes here? If Noted lost its connection to this tab (this
  // happens after an update), reconnect it. Chrome blocks extensions on its
  // own pages, so those stay disabled.
  try {
    const res = await chrome.tabs.sendMessage(activeTab.id, { type: "count" });
    if (!res || typeof res.count !== "number") throw new Error("not connected");
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(activeTab.id, { type: "count" });
    } catch {
      $("#add").disabled = true;
      $("#blocked").hidden = false;
    }
  }

  $("#add").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(activeTab.id, { type: "add-note", at: "viewport" }).catch(() => {});
    window.close();
  });

  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tab))
  );

  const saved = await chrome.storage.local.get("popupTab");
  await load();
  setTab(saved.popupTab || "page");
}

async function load() {
  const all = await chrome.storage.local.get(null);
  notes = Object.entries(all)
    .filter(([k]) => k.startsWith("note:"))
    .map(([, v]) => v)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  setCount("#count-page", notes.filter(isHere).length);
  setCount("#count-all", notes.length);
}

function setCount(sel, n) {
  const el = $(sel);
  el.textContent = n;
  el.hidden = n === 0;
}

function setTab(t) {
  tab = t;
  document.querySelectorAll(".tabs button").forEach((b) => {
    const on = b.dataset.tab === t;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  chrome.storage.local.set({ popupTab: t });
  render();
}

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

function isHere(n) {
  if (!here) return false;
  return n.scope === "site" ? hostOf(n.origin) === hostOf(here.origin) : samePage(n.origin, n.path, here);
}

// ---------- rendering ----------
function render() {
  const list = $("#list");
  list.textContent = "";

  if (tab === "page") {
    const mine = notes.filter(isHere);
    if (!mine.length) return empty(list, "No notes on this page yet.");
    mine.forEach((n) => list.appendChild(item(n)));
    return;
  }

  if (!notes.length) return empty(list, "You haven't made any notes yet.");
  const groups = new Map();
  for (const n of notes) {
    const g = dateGroup(n.updated || n.created);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }
  for (const [name, items] of groups) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const h = document.createElement("h2");
    h.textContent = name;
    sec.appendChild(h);
    items.forEach((n) => sec.appendChild(item(n)));
    list.appendChild(sec);
  }
}

function empty(list, text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  list.appendChild(p);
}

function item(n) {
  const el = document.createElement("div");
  el.className = "item";
  el.tabIndex = 0;
  el.setAttribute("role", "button");

  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = colorOf(n.color);

  const txt = document.createElement("span");
  txt.className = "txt";
  const snip = document.createElement("span");
  snip.className = "snippet";
  snip.textContent = n.text.trim().split("\n")[0] || "(empty note)";
  const where = document.createElement("span");
  where.className = "where";
  where.append(favicon(n), document.createTextNode(
    safeHost(n.origin) + (n.scope === "site" ? " · whole site" : "")
  ));
  txt.append(snip, where);

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = shortTime(n.updated || n.created);

  const del = document.createElement("button");
  del.className = "del";
  del.title = "Delete note";
  del.setAttribute("aria-label", "Delete note");
  del.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    await chrome.storage.local.remove("note:" + n.id);
    await load();
    render();
  });

  el.append(dot, txt, time, del);
  const go = () => openNote(n);
  el.addEventListener("click", go);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  return el;
}

// The site's own icon, with a letter as a fallback.
function favicon(n) {
  const wrap = document.createElement("span");
  wrap.className = "fav";
  const host = safeHost(n.origin);
  const img = document.createElement("img");
  img.alt = "";
  img.src = `/_favicon/?pageUrl=${encodeURIComponent(n.url || n.origin)}&size=16`;
  img.addEventListener("error", () => { img.remove(); wrap.textContent = host.charAt(0).toUpperCase(); });
  wrap.appendChild(img);
  return wrap;
}

// ---------- dates ----------
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

function dateGroup(ts) {
  const today = startOfDay(Date.now());
  const day = 86400000;
  if (ts >= today) return "Today";
  if (ts >= today - day) return "Yesterday";
  if (ts >= today - 6 * day) return "This week";
  const d = new Date(ts), now = new Date();
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
    ? { month: "long" } : { month: "long", year: "numeric" });
}

function shortTime(ts) {
  const today = startOfDay(Date.now());
  const day = 86400000;
  const d = new Date(ts);
  if (ts >= today - day) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (ts >= today - 6 * day) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- helpers ----------
async function openNote(n) {
  // If the note is on the page you're already looking at, just scroll to it.
  if (isHere(n)) {
    await chrome.tabs.sendMessage(activeTab.id, { type: "scroll-to", id: n.id }).catch(() => {});
    window.close();
    return;
  }
  const url = n.scope === "site" ? n.url || n.origin : n.origin + n.path;
  chrome.tabs.create({ url });
  window.close();
}

function safeHost(origin) {
  try { return new URL(origin).hostname.replace(/^www\./, ""); } catch { return origin; }
}

function prettyKeys(s) {
  if (!/Mac/i.test(navigator.platform)) return s;
  return s.replace(/Alt\+|Option\+/g, "⌥").replace(/Shift\+/g, "⇧").replace(/Command\+|Cmd\+/g, "⌘").replace(/Ctrl\+/g, "⌃");
}
