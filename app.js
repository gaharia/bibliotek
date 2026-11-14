// Bibliotek – webbapp med Google-inloggning och synk via Firebase (Firestore).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { getWorks, getSimilar, sameTitle, normName } from "./tips.js";

// ---------- Ikoner ----------
const ICON_READ = '<svg viewBox="0 0 24 24"><path d="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM10,17l-5,-5 1.41,-1.41L10,14.17l7.59,-7.59L19,8l-9,9z"/></svg>';
const ICON_UNREAD = '<svg viewBox="0 0 24 24"><path d="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM12,20c-4.42,0 -8,-3.58 -8,-8s3.58,-8 8,-8 8,3.58 8,8 -3.58,8 -8,8z"/></svg>';
const ICON_OPEN = '<svg viewBox="0 0 24 24"><path d="M19,19H5V5h7V3H5c-1.11,0 -2,0.9 -2,2v14c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2v-7h-2v7zM14,3v2h3.59l-9.83,9.83 1.41,1.41L19,6.41V10h2V3h-7z"/></svg>';
const ICON_TIPS = '<svg viewBox="0 0 24 24"><path d="M9,21c0,0.55 0.45,1 1,1h4c0.55,0 1,-0.45 1,-1v-1L9,20v1zM12,2C8.14,2 5,5.14 5,9c0,2.38 1.19,4.47 3,5.74L8,17c0,0.55 0.45,1 1,1h6c0.55,0 1,-0.45 1,-1v-2.26c1.81,-1.27 3,-3.36 3,-5.74 0,-3.86 -3.14,-7 -7,-7z"/></svg>';
const ICON_BOUGHT = '<svg viewBox="0 0 24 24"><path d="M4,6H2v14c0,1.1 0.9,2 2,2h14v-2H4V6zM20,2H8C6.9,2 6,2.9 6,4v12c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V4c0,-1.1 -0.9,-2 -2,-2zM19,11h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/></svg>';
const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="M10,6L8.59,7.41 13.17,12l-4.58,4.59L10,18l6,-6z"/></svg>';

// ---------- Hjälpfunktioner ----------
const collator = new Intl.Collator("sv", { sensitivity: "accent" });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function authorSortKey(b) {
  const a = (b.author || "").trim();
  if (!a) return "￿";
  if (a.includes(",")) return a;
  const p = a.split(/\s+/);
  return p.length === 1 ? a : p[p.length - 1] + " " + p.slice(0, -1).join(" ");
}
const groupKey = (b) => (b.author || "").trim().toLowerCase();
function goodreadsUrl(b) {
  const q = b.isbn ? b.isbn : [b.title, b.author].filter((x) => x && x.trim()).join(" ");
  return "https://www.goodreads.com/search?q=" + encodeURIComponent(q).replace(/%20/g, "+");
}
function normalizeIsbn(raw) {
  let s = String(raw ?? "").trim();
  if (/e/i.test(s) && !isNaN(Number(s))) s = BigInt(Math.round(Number(s))).toString();
  return s.toUpperCase().replace(/[^0-9X]/g, "");
}
function isValidIsbn(i) {
  return (i.length === 13 && (i.startsWith("978") || i.startsWith("979")) && /^\d+$/.test(i)) ||
    (i.length === 10 && /^\d{9}[\dX]$/.test(i));
}
const parseTags = (s) => [...new Set(String(s).split(/[,;|]/).map((t) => t.trim()).filter(Boolean))];
const plural = (n) => n === 1 ? "1 bok" : n + " böcker";

// ---------- Tema (sparas per enhet) ----------
const THEME_KEY = "bibliotek-tema";
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let themePref = "system";
try { themePref = localStorage.getItem(THEME_KEY) || "system"; } catch (e) {}
function applyTheme() {
  const dark = themePref === "dark" || (themePref === "system" && darkQuery && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#1E2B38" : "#2F4F6F";
}
if (darkQuery) {
  const onChange = () => { if (themePref === "system") applyTheme(); };
  darkQuery.addEventListener ? darkQuery.addEventListener("change", onChange) : darkQuery.addListener(onChange);
}
applyTheme();

// ---------- Firebase ----------
let app, auth, db, booksCol, wishCol;
let unsubscribe = null;
let unsubscribeWishes = null;
let wishes = [];
let mode = "library"; // "library" eller "wish"
let user = null;
let books = [];
let syncState = "";

function firebaseConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("KLISTRA") && firebaseConfig.projectId;
}

function showLogin(message, showButton) {
  $("login").hidden = false;
  $("loginMsg").textContent = message;
  $("loginBtn").hidden = !showButton;
}

function startFirebase() {
  if (!firebaseConfigured()) {
    showLogin("Firebase är inte konfigurerat ännu.\nFyll i firebase-config.js enligt README.", false);
    return;
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, {});
  }
  booksCol = collection(db, "books");
  wishCol = collection(db, "wishlist");

  onAuthStateChanged(auth, (u) => {
    user = u;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (unsubscribeWishes) { unsubscribeWishes(); unsubscribeWishes = null; }
    if (!u) {
      books = [];
      wishes = [];
      showLogin("Logga in för att se ert gemensamma bibliotek.", true);
      return;
    }
    $("login").hidden = true;
    listen();
    renderMenu();
  });
}

$("loginBtn").onclick = async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    if (err && (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request")) return;
    showLogin("Inloggningen misslyckades.\n" + (err && err.message ? err.message : err), true);
  }
};

function listen() {
  unsubscribe = onSnapshot(booksCol, { includeMetadataChanges: true }, (snap) => {
    books = snap.docs.map((d) => fromDoc(d.id, d.data()));
    syncState = snap.metadata.hasPendingWrites ? "sparar …" : (snap.metadata.fromCache ? (navigator.onLine ? "synkar …" : "offline") : "");
    refreshAll();
    if (!unsubscribeWishes) listenWishes();
  }, async (err) => {
    if (err && err.code === "permission-denied") {
      const email = user ? user.email : "";
      await signOut(auth);
      showLogin(`Kontot ${email} har inte behörighet till biblioteket.\nLägg till e-postadressen i databasreglerna (se README) eller logga in med ett annat konto.`, true);
    } else {
      toast("Synkfel: " + (err && err.message ? err.message : err));
    }
  });
}

function listenWishes() {
  unsubscribeWishes = onSnapshot(wishCol, (snap) => {
    wishes = snap.docs.map((d) => wishFromDoc(d.id, d.data()));
    refreshAll();
  }, (err) => {
    if (!err || err.code !== "permission-denied") toast("Synkfel (önskelista): " + (err && err.message ? err.message : err));
  });
}
function wishFromDoc(id, d) {
  return { id, author: String(d.author || ""), title: String(d.title || ""), note: String(d.note || ""), added: Number(d.added) || 0 };
}

function fromDoc(id, d) {
  return {
    id,
    author: String(d.author || ""),
    title: String(d.title || ""),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    read: !!d.read,
    isbn: String(d.isbn || ""),
    added: Number(d.added) || 0
  };
}
function toData(b) {
  return {
    author: b.author, title: b.title, tags: b.tags, read: !!b.read,
    isbn: b.isbn || "", added: b.added || Date.now(), updatedBy: user ? user.email : ""
  };
}
// Skrivningar sparas lokalt direkt och synkas när det finns nät.
function writeFailed(err) { toast("Kunde inte spara: " + (err && err.message ? err.message : err)); }
function addBookDoc(b) { const ref = doc(booksCol); setDoc(ref, toData(b)).catch(writeFailed); return ref.id; }
function updateBookDoc(id, fields) {
  updateDoc(doc(booksCol, id), { ...fields, updatedBy: user ? user.email : "" }).catch(writeFailed);
}
function deleteBookDoc(id) { deleteDoc(doc(booksCol, id)).catch(writeFailed); }
async function runBatches(ops) {
  // Firestore tillåter högst 500 ändringar per batch.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    batch.commit().catch(writeFailed);
  }
}

// ---------- Tillstånd ----------
let query = "";
const selectedTags = new Set();
let sortMode = "author";
let statusFilter = "all";
const expanded = new Set();
let currentSelection = [];

function tagCounts() {
  const m = new Map();
  for (const b of books) for (const t of b.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => collator.compare(a[0], b[0]));
}
const titleCmp = (a, b) => collator.compare(a.title, b.title);
const authorCmp = (a, b) => collator.compare(authorSortKey(a), authorSortKey(b)) || collator.compare(a.title, b.title);

function matches(b, q) {
  for (const t of selectedTags) if (!b.tags.includes(t)) return false;
  if (statusFilter === "read" && !b.read) return false;
  if (statusFilter === "unread" && b.read) return false;
  if (!q) return true;
  return b.author.toLowerCase().includes(q) || b.title.toLowerCase().includes(q) ||
    (b.isbn || "").includes(q) || b.tags.some((t) => t.toLowerCase().includes(q));
}

// ---------- Rendering ----------
function renderChips() {
  const counts = tagCounts();
  const keys = new Set(counts.map((c) => c[0]));
  for (const t of [...selectedTags]) if (!keys.has(t)) selectedTags.delete(t);
  const el = $("chips");
  el.style.display = counts.length ? "flex" : "none";
  el.innerHTML = "";
  for (const [tag, n] of counts) {
    const c = document.createElement("button");
    c.className = "chip" + (selectedTags.has(tag) ? " on" : "");
    c.textContent = `${tag} (${n})`;
    c.onclick = () => { selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag); renderChips(); renderList(); };
    el.appendChild(c);
  }
}

function bookRow(b, grouped) {
  const row = document.createElement("div");
  row.className = "row" + (grouped ? " grouped" : "");
  const showAuthor = !grouped && b.author;
  row.innerHTML = `<div class="txt"><div class="t">${esc(b.title || "Utan titel")}</div>` +
    (showAuthor ? `<div class="a">${esc(b.author)}</div>` : "") +
    (b.tags.length ? `<div class="g">${esc(b.tags.join("  ·  "))}</div>` : "") + `</div>` +
    `<button class="icon-btn read-btn${b.read ? " on" : ""}" aria-label="${b.read ? "Markera som oläst" : "Markera som läst"}">${b.read ? ICON_READ : ICON_UNREAD}</button>` +
    `<a class="icon-btn" href="${esc(goodreadsUrl(b))}" target="_blank" rel="noopener" aria-label="Öppna på Goodreads">${ICON_OPEN}</a>`;
  row.onclick = () => editBook(b);
  row.querySelector(".read-btn").onclick = (e) => { e.stopPropagation(); toggleRead(b); };
  row.querySelector("a").onclick = (e) => e.stopPropagation();
  return row;
}

function renderList() {
  if (mode === "wish") { renderWishList(); return; }
  const q = query.toLowerCase();
  const filtered = books.filter((b) => matches(b, q));
  const list = $("list");
  const scroll = list.scrollTop;
  list.innerHTML = "";

  if (sortMode === "author") {
    const sorted = filtered.slice().sort(authorCmp);
    currentSelection = sorted;
    const groups = new Map();
    for (const b of sorted) { const k = groupKey(b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
    for (const [k, gb] of groups) {
      const open = q !== "" || expanded.has(k);
      const h = document.createElement("div");
      h.className = "header" + (open ? " open" : "");
      h.innerHTML = `${ICON_CHEV}<div class="n">${esc(gb[0].author.trim() || "Okänd författare")}</div>` +
        `<div class="c">${plural(gb.length)} · ${gb.filter((x) => x.read).length} lästa</div>`;
      addTipsButton(h, gb[0].author.trim());
      h.onclick = () => { if (query) return; expanded.has(k) ? expanded.delete(k) : expanded.add(k); renderList(); };
      list.appendChild(h);
      if (open) for (const b of gb) list.appendChild(bookRow(b, true));
    }
  } else {
    const sorted = sortMode === "title" ? filtered.slice().sort(titleCmp) : filtered.slice().sort((a, b) => b.added - a.added);
    currentSelection = sorted;
    for (const b of sorted) list.appendChild(bookRow(b, false));
  }

  if (!books.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Inga böcker ännu.\n\nImportera en Excelfil via menyn (⋮), skanna en streckkod eller lägg till en bok med +.";
    list.appendChild(e);
  }
  list.scrollTop = scroll;
  $("count").innerHTML = `${filtered.length} av ${books.length} böcker · ${filtered.filter((b) => b.read).length} lästa` +
    (syncState ? ` <span class="sync">· ${esc(syncState)}</span>` : "");
}

function refreshAll() {
  const wish = mode === "wish";
  document.querySelector(".appbar h1").textContent = wish ? "Önskelista" : "Bibliotek";
  $("wishBtn").classList.toggle("on", wish);
  $("wishBtn").querySelector("span").textContent = wishes.length ? `Önskelista (${wishes.length})` : "Önskelista";
  $("statusGroup").style.visibility = wish ? "hidden" : "visible";
  if (wish) $("chips").style.display = "none"; else renderChips();
  renderList();
  renderMenu();
}

// ---------- Meny ----------
function renderMenu() {
  const m = $("menu");
  const wish = mode === "wish";
  const items = wish ? [
    ["Skanna streckkod", startScan],
    ["Importera önskelista (Excel)", () => { importTarget = "wish"; $("importInput").click(); }],
    ["Exportera önskelista", exportWishes],
  ] : [
    ["Skanna streckkod", startScan],
    ["Importera Excel", () => { importTarget = "library"; $("importInput").click(); }],
    ["Exportera Excel", chooseExport],
    ["Sortera", chooseSort],
  ];
  if (!wish && sortMode === "author") {
    items.push(["Fäll ut alla författare", () => { books.forEach((b) => expanded.add(groupKey(b))); renderList(); }]);
    items.push(["Fäll ihop alla författare", () => { expanded.clear(); renderList(); }]);
  }
  items.push(["Tema", chooseTheme]);
  items.push(["Radera alla böcker", confirmDeleteAll]);
  if (user) items.push([`Logga ut (${user.email})`, () => signOut(auth)]);
  m.innerHTML = "";
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { m.classList.remove("open"); fn(); };
    m.appendChild(b);
  }
}
$("menuBtn").onclick = (e) => { e.stopPropagation(); $("menu").classList.toggle("open"); };
document.addEventListener("click", (e) => { if (!$("menu").contains(e.target)) $("menu").classList.remove("open"); });

function choiceDialog(title, opts, current, onPick) {
  const body = document.createElement("div");
  const d = dialog({ title, body, buttons: [{ label: "Avbryt" }] });
  for (const [k, label] of opts) {
    const b = document.createElement("button");
    b.className = "list-choice" + (current === k ? " on" : "");
    b.textContent = label;
    b.onclick = () => { d.close(); onPick(k); };
    body.appendChild(b);
  }
}
function chooseSort() {
  choiceDialog("Sortera", [["author", "Författare (efternamn)"], ["title", "Titel"], ["added", "Senast tillagd"]], sortMode,
    (k) => { sortMode = k; renderList(); renderMenu(); });
}
function chooseTheme() {
  choiceDialog("Tema", [["system", "Följ systemet"], ["light", "Ljust"], ["dark", "Mörkt"]], themePref, (k) => {
    themePref = k;
    try { localStorage.setItem(THEME_KEY, k); } catch (e) {}
    applyTheme();
  });
}

// ---------- Dialoger, snackbar, toast ----------
function dialog({ title, body, buttons = [], neutral = null, cancelable = true }) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const d = document.createElement("div");
  d.className = "dialog";
  if (title) { const h = document.createElement("h2"); h.textContent = title; d.appendChild(h); }
  const bd = document.createElement("div");
  bd.className = "body";
  if (typeof body === "string") bd.textContent = body; else if (body) bd.appendChild(body);
  d.appendChild(bd);
  const close = () => scrim.remove();
  if (buttons.length || neutral) {
    const act = document.createElement("div");
    act.className = "actions";
    const mk = (b) => {
      const el = document.createElement("button");
      el.className = "btn-text";
      el.textContent = b.label;
      el.onclick = () => { if (b.action && b.action() === false) return; close(); };
      return el;
    };
    if (neutral) act.appendChild(mk(neutral));
    const sp = document.createElement("div"); sp.className = "spacer"; act.appendChild(sp);
    for (const b of buttons) act.appendChild(mk(b));
    d.appendChild(act);
  }
  scrim.appendChild(d);
  if (cancelable) scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  $("phone").appendChild(scrim);
  return { close, el: d };
}

let snackTimer = null;
function snackbar(text, actionLabel, action, ms = 4000) {
  document.querySelectorAll(".snackbar").forEach((s) => s.remove());
  $("phone").classList.remove("snack");
  const s = document.createElement("div");
  s.className = "snackbar";
  s.innerHTML = `<span>${esc(text)}</span>`;
  if (actionLabel) {
    const b = document.createElement("button");
    b.textContent = actionLabel;
    b.onclick = () => action();
    s.appendChild(b);
  }
  $("phone").appendChild(s);
  $("phone").classList.add("snack");
  const done = () => { s.remove(); if (!document.querySelector(".snackbar")) $("phone").classList.remove("snack"); };
  s.querySelectorAll("button").forEach((b) => b.addEventListener("click", done));
  clearTimeout(snackTimer);
  snackTimer = setTimeout(done, ms);
}
function toast(text) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  $("phone").appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function field(label, value = "", attrs = "") {
  const w = document.createElement("div");
  w.className = "field";
  w.innerHTML = `<label>${esc(label)}</label><input ${attrs}>`;
  w.querySelector("input").value = value;
  return w;
}
function suggestions(container, labelText, onPick) {
  const tags = tagCounts().map((c) => c[0]);
  if (!tags.length) return;
  const l = document.createElement("div");
  l.className = "sugg-label";
  l.textContent = labelText;
  const g = document.createElement("div");
  g.className = "sugg";
  for (const t of tags) {
    const c = document.createElement("button");
    c.className = "chip";
    c.textContent = t;
    c.onclick = () => onPick(t);
    g.appendChild(c);
  }
  container.append(l, g);
}

// ---------- Läst / oläst ----------
function toggleRead(b) {
  const now = !b.read;
  updateBookDoc(b.id, { read: now });
  snackbar(`”${b.title}” markerad som ${now ? "läst" : "oläst"}`, "Ångra", () => updateBookDoc(b.id, { read: !now }));
}

// ---------- Lägg till / redigera ----------
function editBook(book, prefill = null, prefillIsbn = "", fromScan = false, fromWishId = null) {
  const body = document.createElement("div");
  const fA = field("Författare", book ? book.author : (prefill?.author || ""));
  const fT = field("Titel", book ? book.title : (prefill?.title || ""));
  const fI = field("ISBN", book ? (book.isbn || "") : prefillIsbn, 'inputmode="numeric"');
  const sw = document.createElement("div");
  sw.className = "switch-row";
  let read = book ? !!book.read : false; // Oläst är standard
  sw.innerHTML = `<span>Läst</span><div class="switch${read ? " on" : ""}" role="switch" aria-checked="${read}"></div>`;
  sw.onclick = () => { read = !read; sw.lastChild.classList.toggle("on", read); sw.lastChild.setAttribute("aria-checked", read); };
  const fG = field("Taggar (separera med kommatecken)", book ? book.tags.join(", ") : "");
  body.append(fA, fT, fI, sw, fG);
  const inA = fA.querySelector("input"), inT = fT.querySelector("input"), inI = fI.querySelector("input"), inG = fG.querySelector("input");
  suggestions(body, "Befintliga taggar – tryck för att lägga till", (t) => {
    const cur = parseTags(inG.value);
    if (!cur.includes(t)) inG.value = [...cur, t].join(", ");
  });
  const gr = document.createElement("a");
  gr.className = "btn-text";
  gr.target = "_blank";
  gr.rel = "noopener";
  gr.style.marginTop = "8px";
  gr.innerHTML = ICON_OPEN + "Öppna på Goodreads";
  const updGr = () => { gr.href = goodreadsUrl({ author: inA.value.trim(), title: inT.value.trim(), isbn: normalizeIsbn(inI.value) }); };
  [inA, inT, inI].forEach((i) => i.addEventListener("input", updGr));
  updGr();
  body.appendChild(gr);

  dialog({
    title: book ? "Redigera bok" : "Ny bok",
    body,
    neutral: book ? { label: "Ta bort", action: () => confirmDelete(book) } : null,
    buttons: [
      { label: "Avbryt" },
      { label: "Spara", action: () => {
        const author = inA.value.trim(), title = inT.value.trim();
        if (!author && !title) { toast("Fyll i författare eller titel"); return; }
        const tags = parseTags(inG.value), isbn = normalizeIsbn(inI.value);
        if (!book) {
          addBookDoc({ author, title, tags, read, isbn, added: Date.now() });
          if (fromWishId) { deleteWish(fromWishId); toast(`”${title}” flyttad från önskelistan till biblioteket`); }
          else setTimeout(() => checkWishAfterAdd(author, title), 300);
        } else updateBookDoc(book.id, { author, title, tags, read, isbn });
        expanded.add(author.toLowerCase());
        if (fromScan) snackbar(`”${title}” sparad`, "Skanna nästa", startScan, 6000);
      } }
    ]
  });
}

function confirmDelete(b) {
  dialog({ body: `Ta bort ”${b.title}”?`, buttons: [
    { label: "Avbryt" },
    { label: "Ta bort", action: () => deleteBookDoc(b.id) }
  ] });
}
function confirmDeleteAll() {
  if (!books.length) return;
  dialog({ title: "Radera alla böcker", body: `Vill du radera alla ${books.length} böcker? Det gäller båda era telefoner och går inte att ångra. Exportera gärna till Excel först.`, buttons: [
    { label: "Avbryt" },
    { label: "Ta bort", action: () => { runBatches(books.map((b) => (batch) => batch.delete(doc(booksCol, b.id)))); } }
  ] });
}

$("addBtn").onclick = () => (mode === "wish" ? editWish(null) : editBook(null));

// ---------- Streckkod ----------
// Kameraskanning fungerar i Chrome på Android. På iPhone saknar Safari streckkodsläsning,
// så där skriver man in ISBN (uppslaget av författare och titel fungerar ändå).
let scanStream = null;
let scanning = false;

async function startScan() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    manualIsbn("Den här webbläsaren kan inte skanna streckkoder (gäller iPhone). Skriv in ISBN-numret, så hämtas författare och titel.");
    return;
  }
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (err) {
    stopScan();
    manualIsbn("Kameran kunde inte startas (" + (err && err.message ? err.message : err) + "). Skriv in ISBN i stället.");
    return;
  }
  const video = $("scanVideo");
  video.srcObject = scanStream;
  $("scanner").hidden = false;
  try { await video.play(); } catch (e) {}
  scanning = true;
  const tick = async () => {
    if (!scanning) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        if (codes.length && scanning) {
          const raw = codes[0].rawValue;
          if (navigator.vibrate) navigator.vibrate(60);
          stopScan();
          onBarcode(raw);
          return;
        }
      }
    } catch (e) {}
    setTimeout(tick, 200);
  };
  tick();
}
function stopScan() {
  scanning = false;
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  $("scanVideo").srcObject = null;
  $("scanner").hidden = true;
}
$("scanClose").onclick = stopScan;
$("scanManual").onclick = () => { stopScan(); manualIsbn(); };
$("scanBtn").onclick = startScan;

function manualIsbn(note) {
  const body = document.createElement("div");
  if (note) { const n = document.createElement("div"); n.className = "note"; n.style.marginTop = "0"; n.textContent = note; body.appendChild(n); }
  const f = field("ISBN", "", 'inputmode="numeric"');
  body.appendChild(f);
  const inp = f.querySelector("input");
  const go = () => onBarcode(inp.value);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { d.close(); go(); } });
  const d = dialog({ title: "Skriv ISBN", body, buttons: [{ label: "Avbryt" }, { label: "Sök", action: go }] });
  setTimeout(() => inp.focus(), 50);
}

function onBarcode(raw) {
  const isbn = normalizeIsbn(raw);
  if (!isValidIsbn(isbn)) {
    dialog({ body: `Streckkoden ${raw} ser inte ut att vara ett ISBN. Bokens ISBN-streckkod börjar oftast med 978 eller 979.`, buttons: [
      { label: "Avbryt" }, { label: "Försök igen", action: startScan }
    ] });
    return;
  }
  const existing = books.find((b) => b.isbn === isbn);
  if (mode === "wish") {
    const prog = progress(`Söker efter ISBN ${isbn} …`);
    lookup(isbn).then((res) => {
      prog.close();
      if (existing) toast(`Du har redan ”${existing.title}” i biblioteket`);
      else if (!res) toast("Hittade ingen information om boken. Fyll i själv.");
      editWish(null, res || (existing ? { author: existing.author, title: existing.title } : null));
    });
    return;
  }
  if (existing) {
    dialog({ title: "Boken finns redan", body: `”${existing.title}” av ${existing.author} finns redan i biblioteket.`,
      neutral: { label: "Skanna nästa", action: startScan },
      buttons: [{ label: "Avbryt" }, { label: "Öppna", action: () => editBook(existing) }] });
    return;
  }
  const prog = progress(`Söker efter ISBN ${isbn} …`);
  lookup(isbn).then((res) => {
    prog.close();
    if (!res) toast("Hittade ingen information om boken. Fyll i författare och titel själv.");
    editBook(null, res, isbn, true);
  });
}

function progress(text) {
  const b = document.createElement("div");
  b.className = "progress";
  b.innerHTML = `<div class="spinner"></div><div>${esc(text)}</div>`;
  const d = dialog({ body: b, cancelable: false });
  d.el.querySelector(".body").style.padding = "0";
  return d;
}

// Uppslag: LIBRIS (svenska böcker), Google Books, Open Library.
async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch (e) { return null; } finally { clearTimeout(t); }
}
const first = (v) => Array.isArray(v) ? (v[0] || "") : (v || "");
function invertName(n) {
  const p = String(n).split(",").map((s) => s.trim()).filter((s) => s && !/\d/.test(s));
  return p.length >= 2 ? p[1] + " " + p[0] : (p[0] || "");
}
async function lookup(isbn) {
  const sources = [
    async () => { const j = await getJson(`https://libris.kb.se/xsearch?query=isbn:${isbn}&format=json&n=1`);
      const o = j?.xsearch?.list?.[0]; return o ? { author: invertName(first(o.creator)), title: first(o.title).split(" / ")[0].trim() } : null; },
    async () => { const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      const v = j?.items?.[0]?.volumeInfo; return v ? { author: (v.authors || [""])[0], title: v.title || "" } : null; },
    async () => { const j = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const o = j?.["ISBN:" + isbn]; return o ? { author: o.authors?.[0]?.name || "", title: o.title || "" } : null; }
  ];
  for (const s of sources) { try { const r = await s(); if (r && r.title) return r; } catch (e) {} }
  return null;
}

// ---------- Import ----------
const H = {
  author: ["författare", "forfattare", "author", "authors", "upphov", "upphovsperson"],
  title: ["titel", "title", "bok", "boktitel", "verk"],
  tags: ["taggar", "tagg", "tags", "tag", "kategori", "kategorier", "category", "categories", "genre"],
  status: ["status", "läst", "last", "lässtatus", "read"],
  isbn: ["isbn", "isbn-13", "isbn13", "isbn-10", "isbn10"],
  note: ["anteckning", "anteckningar", "notering", "kommentar", "note", "notes"]
};
let importTarget = "library";
const READ_V = ["läst", "last", "ja", "j", "x", "1", "true", "sant", "read", "yes", "✓", "✔"];
const UNREAD_V = ["oläst", "olast", "nej", "n", "0", "false", "falskt", "unread", "no"];
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/:$/, "");

$("importInput").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (typeof XLSX === "undefined") throw new Error("Excel-läsaren kunde inte laddas.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("Hittade inget kalkylblad i filen.");
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false })
      .map((r) => r.map((c) => String(c ?? "").trim()));
    const rows = toRows(grid);
    if (!rows.length) dialog({ body: "Hittade inga böcker i filen. Använd rubrikerna Författare och Titel (och gärna Taggar, Status och ISBN), eller lägg författare i kolumn A och titel i kolumn B.", buttons: [{ label: "OK" }] });
    else if (importTarget === "wish") askImportWishes(rows);
    else askCommonTag(rows);
  } catch (err) {
    dialog({ title: "Importen misslyckades", body: "Filen verkar inte vara en Excelfil i .xlsx-format.\n\n" + (err.message || err), buttons: [{ label: "OK" }] });
  }
};

function toRows(grid) {
  if (!grid.length) return [];
  const header = grid[0];
  const find = (names) => { const i = header.findIndex((v) => names.includes(norm(v))); return i < 0 ? null : i; };
  let aCol = find(H.author), tCol = find(H.title);
  const gCol = find(H.tags), sCol = find(H.status), iCol = find(H.isbn), nCol = find(H.note);
  const hasHeader = [aCol, tCol, gCol, sCol, iCol, nCol].some((x) => x !== null);
  if (aCol === null && tCol === null) { aCol = 0; tCol = 1; }
  else if (aCol === null) aCol = tCol === 0 ? 1 : 0;
  else if (tCol === null) tCol = aCol === 1 ? 0 : 1;
  const data = hasHeader ? grid.slice(1) : grid;
  const out = [];
  for (const r of data) {
    const author = (r[aCol] || "").trim(), title = (r[tCol] || "").trim();
    if (!author && !title) continue;
    const tags = gCol === null ? [] : parseTags(r[gCol] || "");
    const sv = sCol === null ? "" : norm(r[sCol]);
    const read = READ_V.includes(sv) ? true : UNREAD_V.includes(sv) ? false : null;
    const isbn = iCol === null ? "" : normalizeIsbn(r[iCol]);
    const note = nCol === null ? "" : (r[nCol] || "").trim();
    out.push({ author, title, tags, read, isbn, note });
  }
  return out;
}

function askCommonTag(rows) {
  const body = document.createElement("div");
  const own = rows.filter((r) => r.tags.length).length;
  const msg = document.createElement("div");
  msg.textContent = `Hittade ${rows.length} böcker i filen.\n\nSka alla få en gemensam tagg? Lämna tomt för ingen.` +
    (own ? `\n\n${own} av böckerna har redan taggar i filen. De behålls, och den gemensamma taggen läggs till.` : "");
  const f = field("Gemensam tagg, t.ex. Skönlitteratur");
  body.append(msg, f);
  const inp = f.querySelector("input");
  suggestions(body, "Eller välj en befintlig tagg", (t) => { inp.value = t; });
  dialog({ title: "Importera böcker", body, buttons: [
    { label: "Avbryt" },
    { label: "Importera", action: () => {
      const res = importRows(rows, parseTags(inp.value));
      toast(`${res.added} nya böcker, ${res.updated} uppdaterade, ${res.unchanged} fanns redan`);
      setTimeout(() => checkWishesAfterImport(rows), 400);
    } }
  ] });
}

function importRows(rows, common) {
  const key = (a, t) => a.trim().toLowerCase() + "\u0000" + t.trim().toLowerCase();
  const index = new Map(books.map((b) => [key(b.author, b.title), b]));
  const seenNew = new Set();
  const ops = [];
  let added = 0, updated = 0, unchanged = 0;
  const now = Date.now();
  for (const r of rows) {
    const tags = [...new Set([...r.tags, ...common])];
    const k = key(r.author, r.title);
    const ex = index.get(k);
    if (!ex) {
      if (seenNew.has(k)) { unchanged++; continue; }
      seenNew.add(k);
      const data = toData({ author: r.author, title: r.title, tags, read: r.read ?? false, isbn: r.isbn, added: now + added });
      ops.push((batch) => batch.set(doc(booksCol), data));
      added++;
    } else {
      const fields = {};
      const newTags = [...new Set([...ex.tags, ...tags])];
      if (newTags.length !== ex.tags.length) fields.tags = newTags;
      if (r.read === true && !ex.read) fields.read = true;
      if (!ex.isbn && r.isbn) fields.isbn = r.isbn;
      if (Object.keys(fields).length) {
        fields.updatedBy = user ? user.email : "";
        ops.push((batch) => batch.update(doc(booksCol, ex.id), fields));
        updated++;
      } else unchanged++;
    }
  }
  runBatches(ops);
  return { added, updated, unchanged };
}

// ---------- Export (manuell) ----------
function chooseExport() {
  if (!books.length) { toast("Det finns inga böcker att exportera"); return; }
  const all = books.slice().sort(authorCmp);
  const sel = currentSelection;
  if (sel.length === all.length) { exportBooks(all); return; }
  choiceDialog("Exportera Excel", [["all", `Hela biblioteket (${all.length} böcker)`], ["sel", `Det som visas nu (${sel.length} böcker)`]], null,
    (k) => exportBooks(k === "all" ? all : sel));
}

function exportBooks(list) {
  if (typeof XLSX === "undefined") { toast("Exporten misslyckades"); return; }
  const aoa = [["Författare", "Titel", "Taggar", "Status", "ISBN"]].concat(
    list.map((b) => [b.author, b.title, b.tags.join(", "), b.read ? "Läst" : "Oläst", b.isbn || ""]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 32 }, { wch: 50 }, { wch: 30 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Böcker");
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Bibliotek.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Exporterade ${list.length} böcker`);
}

// ---------- Önskelista ----------
function sameAuthor(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" "), ys = y.split(" ");
  // "Leo Tolstoj" = "Lev Tolstoj": samma efternamn och samma initial.
  return xs[xs.length - 1] === ys[ys.length - 1] && xs[0][0] === ys[0][0];
}
const ownsTitle = (author, title) => books.some((b) => sameTitle(b.title, title) && (!author || !b.author || sameAuthor(b.author, author)));
const ownsAuthor = (author) => books.some((b) => sameAuthor(b.author, author));
const wishFor = (author, title) => wishes.find((w) => w.title && sameTitle(w.title, title) && (!author || sameAuthor(w.author, author)));
const authorWish = (author) => wishes.find((w) => !w.title && sameAuthor(w.author, author));

function addWish({ author, title = "", note = "" }) {
  if (title ? wishFor(author, title) : authorWish(author)) { toast("Finns redan på önskelistan"); return false; }
  setDoc(doc(wishCol), { author, title, note, added: Date.now(), updatedBy: user ? user.email : "" }).catch(writeFailed);
  return true;
}
function deleteWish(id) { deleteDoc(doc(wishCol, id)).catch(writeFailed); }

$("wishBtn").onclick = () => {
  mode = mode === "wish" ? "library" : "wish";
  $("list").scrollTop = 0;
  refreshAll();
};

function addTipsButton(header, author) {
  if (!author || /^(antologi|okänd)/i.test(author)) return;
  const b = document.createElement("button");
  b.className = "icon-btn tips-btn";
  b.setAttribute("aria-label", `Tips om ${author}`);
  b.title = "Tips: centrala verk och liknande författare";
  b.innerHTML = ICON_TIPS;
  b.onclick = (e) => { e.stopPropagation(); showTips(author); };
  header.appendChild(b);
}

const collapsedWish = new Set();
function renderWishList() {
  const q = query.toLowerCase();
  const filtered = wishes.filter((w) => !q || w.author.toLowerCase().includes(q) || w.title.toLowerCase().includes(q) || w.note.toLowerCase().includes(q));
  const list = $("list");
  const scroll = list.scrollTop;
  list.innerHTML = "";
  const sorted = filtered.slice().sort((a, b) =>
    collator.compare(authorSortKey(a), authorSortKey(b)) || (a.title ? 1 : 0) - (b.title ? 1 : 0) || collator.compare(a.title, b.title));
  const groups = new Map();
  for (const w of sorted) { const k = groupKey(w); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
  for (const [k, gw] of groups) {
    const open = q !== "" || !collapsedWish.has(k);
    const titles = gw.filter((w) => w.title).length;
    const whole = gw.some((w) => !w.title);
    const h = document.createElement("div");
    h.className = "header" + (open ? " open" : "");
    const info = [titles ? (titles === 1 ? "1 titel" : titles + " titlar") : "", whole ? "författarskapet" : ""].filter(Boolean).join(" · ");
    h.innerHTML = `${ICON_CHEV}<div class="n">${esc(gw[0].author.trim() || "Okänd författare")}</div><div class="c">${info}</div>`;
    addTipsButton(h, gw[0].author.trim());
    h.onclick = () => { if (query) return; collapsedWish.has(k) ? collapsedWish.delete(k) : collapsedWish.add(k); renderList(); };
    list.appendChild(h);
    if (!open) continue;
    for (const w of gw) list.appendChild(wishRow(w));
  }
  if (!wishes.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Önskelistan är tom.\n\nLägg till en titel eller en författare du är nyfiken på med +, importera en Excelfil via menyn (⋮), eller tryck på glödlampan vid en författare för att få tips.";
    list.appendChild(e);
  }
  list.scrollTop = scroll;
  $("count").innerHTML = `${filtered.length} på önskelistan` + (syncState ? ` <span class="sync">· ${esc(syncState)}</span>` : "");
}

function wishRow(w) {
  const row = document.createElement("div");
  row.className = "row grouped";
  const title = w.title ? esc(w.title) : `<i>Intresserad av författarskapet</i>`;
  row.innerHTML = `<div class="txt"><div class="t">${title}</div>` +
    (w.note ? `<div class="a">${esc(w.note)}</div>` : "") + `</div>` +
    (w.title ? `<button class="icon-btn bought-btn" aria-label="Jag har den – flytta till biblioteket" title="Jag har den – flytta till biblioteket">${ICON_BOUGHT}</button>` : "") +
    `<a class="icon-btn" href="${esc(goodreadsUrl({ title: w.title, author: w.author, isbn: "" }))}" target="_blank" rel="noopener" aria-label="Öppna på Goodreads">${ICON_OPEN}</a>`;
  row.onclick = () => editWish(w);
  const bought = row.querySelector(".bought-btn");
  if (bought) bought.onclick = (e) => { e.stopPropagation(); moveToLibrary(w); };
  row.querySelector("a").onclick = (e) => e.stopPropagation();
  return row;
}

function moveToLibrary(w) {
  editBook(null, { author: w.author, title: w.title }, "", false, w.id);
}

function editWish(w, prefill = null) {
  const body = document.createElement("div");
  const fA = field("Författare", w ? w.author : (prefill?.author || ""));
  const fT = field("Titel (lämna tomt för hela författarskapet)", w ? w.title : (prefill?.title || ""));
  const fN = field("Anteckning (valfritt)", w ? w.note : (prefill?.note || ""));
  body.append(fA, fT, fN);
  const inA = fA.querySelector("input"), inT = fT.querySelector("input"), inN = fN.querySelector("input");
  if (w && w.title) {
    const mv = document.createElement("button");
    mv.className = "btn-text";
    mv.style.marginTop = "8px";
    mv.innerHTML = ICON_BOUGHT + "Jag har den – flytta till biblioteket";
    body.appendChild(mv);
    mv.onclick = () => { d.close(); moveToLibrary(w); };
  }
  if (inA.value.trim()) {
    const tb = document.createElement("button");
    tb.className = "btn-text";
    tb.innerHTML = ICON_TIPS + "Tips om författaren";
    tb.onclick = () => { d.close(); showTips(inA.value.trim()); };
    body.appendChild(tb);
  }
  const d = dialog({
    title: w ? "Redigera önskning" : "Lägg till på önskelistan",
    body,
    neutral: w ? { label: "Ta bort", action: () => deleteWish(w.id) } : null,
    buttons: [
      { label: "Avbryt" },
      { label: "Spara", action: () => {
        const author = inA.value.trim(), title = inT.value.trim(), note = inN.value.trim();
        if (!author && !title) { toast("Fyll i författare eller titel"); return false; }
        if (w) {
          updateDoc(doc(wishCol, w.id), { author, title, note, updatedBy: user ? user.email : "" }).catch(writeFailed);
          return;
        }
        if (title && ownsTitle(author, title)) {
          setTimeout(() => dialog({
            title: "Finns redan i biblioteket",
            body: `Du har redan ”${title}” i biblioteket. Vill du ändå lägga den på önskelistan, t.ex. för en annan utgåva?`,
            buttons: [{ label: "Avbryt" }, { label: "Lägg till ändå", action: () => { if (addWish({ author, title, note })) toast("Tillagd på önskelistan"); } }]
          }), 50);
          return;
        }
        if (addWish({ author, title, note })) toast("Tillagd på önskelistan");
      } }
    ]
  });
  setTimeout(() => (inA.value ? inT : inA).focus(), 50);
}

// En bok har lagts till i biblioteket: fanns den på önskelistan?
function checkWishAfterAdd(author, title) {
  const w = wishFor(author, title);
  if (!w) return;
  dialog({
    title: "Finns på önskelistan",
    body: `”${w.title}” av ${w.author} står på önskelistan. Vill du ta bort den därifrån nu när du har den?`,
    buttons: [{ label: "Behåll" }, { label: "Ta bort från önskelistan", action: () => deleteWish(w.id) }]
  });
}
function checkWishesAfterImport(rows) {
  const found = new Map();
  for (const r of rows) { const w = r.title && wishFor(r.author, r.title); if (w) found.set(w.id, w); }
  if (!found.size) return;
  const list = [...found.values()];
  const names = list.slice(0, 8).map((w) => `• ${w.title} (${w.author})`).join("\n") + (list.length > 8 ? `\n… och ${list.length - 8} till` : "");
  dialog({
    title: "Finns på önskelistan",
    body: `${list.length === 1 ? "En av böckerna" : list.length + " av böckerna"} du importerade står på önskelistan:\n\n${names}\n\nVill du ta bort ${list.length === 1 ? "den" : "dem"} från önskelistan?`,
    buttons: [{ label: "Behåll" }, { label: "Ta bort", action: () => runBatches(list.map((w) => (batch) => batch.delete(doc(wishCol, w.id)))) }]
  });
}

function askImportWishes(rows) {
  let owned = 0, dup = 0;
  const seen = new Set(), add = [];
  for (const r of rows) {
    const key = normName(r.author) + "|" + (r.title ? normName(r.title) : "");
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);
    if (r.title && ownsTitle(r.author, r.title)) { owned++; continue; }
    if (r.title ? wishFor(r.author, r.title) : authorWish(r.author)) { dup++; continue; }
    add.push(r);
  }
  const msg = `Hittade ${rows.length} rader i filen.\n\n• ${add.length} läggs till på önskelistan` +
    (dup ? `\n• ${dup} finns redan på önskelistan` : "") +
    (owned ? `\n• ${owned} har du redan i biblioteket och hoppas över` : "") +
    `\n\nRader med bara ett författarnamn blir ”intresserad av författarskapet”.`;
  dialog({ title: "Importera önskelista", body: msg, buttons: [
    { label: "Avbryt" },
    { label: "Importera", action: () => {
      if (!add.length) return;
      const now = Date.now();
      runBatches(add.map((r, i) => (batch) => batch.set(doc(wishCol), {
        author: r.author, title: r.title, note: r.note || "", added: now + i, updatedBy: user ? user.email : ""
      })));
      toast(`${add.length} tillagda på önskelistan`);
    } }
  ] });
}

function exportWishes() {
  if (!wishes.length) { toast("Önskelistan är tom"); return; }
  if (typeof XLSX === "undefined") { toast("Exporten misslyckades"); return; }
  const list = wishes.slice().sort((a, b) => collator.compare(authorSortKey(a), authorSortKey(b)) || collator.compare(a.title, b.title));
  const ws = XLSX.utils.aoa_to_sheet([["Författare", "Titel", "Anteckning"]].concat(list.map((w) => [w.author, w.title, w.note])));
  ws["!cols"] = [{ wch: 32 }, { wch: 50 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Önskelista");
  downloadXlsx(wb, "Onskelista.xlsx");
  toast(`Exporterade ${list.length} önskningar`);
}
function downloadXlsx(wb, filename) {
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- Tips om en författare ----------
function showTips(author, refresh = false) {
  const body = document.createElement("div");
  body.className = "tips";
  body.innerHTML = `<h3>Centrala verk du inte har</h3><div class="tips-works"><div class="progress small"><div class="spinner"></div><div>Hämtar verk …</div></div></div>` +
    `<h3>Liknande och kompletterande författare</h3><div class="tips-similar"><div class="progress small"><div class="spinner"></div><div>Letar efter liknande författare … (kan ta upp till en halv minut första gången)</div></div></div>` +
    `<p class="tips-source">Källor: Wikidata och Open Library (öppna databaser). Sparas i 30 dagar på enheten.</p>`;
  const d = dialog({
    title: author,
    body,
    neutral: { label: "Uppdatera", action: () => { setTimeout(() => showTips(author, true), 50); } },
    buttons: [{ label: "Stäng" }]
  });
  const worksBox = body.querySelector(".tips-works"), simBox = body.querySelector(".tips-similar");

  getWorks(author, { refresh }).then((data) => {
    const fresh = [], owned = [];
    for (const w of data.works) (ownsTitle(author, w.title) ? owned : fresh).push(w);
    worksBox.innerHTML = "";
    if (!data.works.length) { worksBox.innerHTML = `<p class="muted">Hittade inga verk för ${esc(author)} i de öppna databaserna.</p>`; return; }
    if (!fresh.length) worksBox.innerHTML = `<p class="muted">Du har redan alla de mest kända verken.</p>`;
    const show = (items) => items.forEach((w) => worksBox.appendChild(tipItem({
      title: w.title + (w.year ? ` (${w.year})` : ""),
      sub: w.notable ? "Räknas som ett av författarens viktigaste verk" : "",
      onWish: wishFor(author, w.title) ? null : () => addWish({ author, title: w.title, note: "Tips: centralt verk" }),
      wished: !!wishFor(author, w.title),
      link: goodreadsUrl({ title: w.title, author, isbn: "" })
    })));
    show(fresh.slice(0, 6));
    if (fresh.length > 6) {
      const more = document.createElement("button");
      more.className = "btn-text";
      more.textContent = `Visa ${fresh.length - 6} till`;
      more.onclick = () => { more.remove(); show(fresh.slice(6)); };
      worksBox.appendChild(more);
    }
    if (owned.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `${owned.length} av verken har du redan och visas inte.`;
      worksBox.appendChild(p);
    }
  }).catch(() => { worksBox.innerHTML = `<p class="muted">Kunde inte hämta verk just nu. Försök igen senare.</p>`; });

  getSimilar(author, { refresh }).then((data) => {
    simBox.innerHTML = "";
    if (!data.similar.length) { simBox.innerHTML = `<p class="muted">Hittade inga liknande författare i de öppna databaserna.</p>`; return; }
    const sorted = data.similar.slice().sort((a, b) => (ownsAuthor(a.name) ? 1 : 0) - (ownsAuthor(b.name) ? 1 : 0));
    sorted.slice(0, 10).forEach((s) => {
      const own = ownsAuthor(s.name);
      simBox.appendChild(tipItem({
        title: s.name,
        sub: s.reasons.join(" · "),
        badge: own ? "Finns i ditt bibliotek" : "",
        onWish: own || authorWish(s.name) ? null : () => addWish({ author: s.name, note: `Tips via ${author}` }),
        wished: !!authorWish(s.name),
        onTips: () => { d.close(); showTips(s.name); },
        link: "https://www.goodreads.com/search?q=" + encodeURIComponent(s.name).replace(/%20/g, "+")
      }));
    });
  }).catch(() => { simBox.innerHTML = `<p class="muted">Kunde inte hämta liknande författare just nu. Försök igen senare.</p>`; });
}

function tipItem({ title, sub, badge, onWish, wished, onTips, link }) {
  const el = document.createElement("div");
  el.className = "tip";
  el.innerHTML = `<div class="tip-txt"><div class="tip-t">${esc(title)}</div>` +
    (sub ? `<div class="tip-s">${esc(sub)}</div>` : "") +
    (badge ? `<div class="tip-b">${esc(badge)}</div>` : "") + `</div><div class="tip-actions"></div>`;
  const act = el.querySelector(".tip-actions");
  if (wished) {
    act.insertAdjacentHTML("beforeend", `<span class="tip-done">På önskelistan ✓</span>`);
  } else if (onWish) {
    const b = document.createElement("button");
    b.className = "btn-text small";
    b.textContent = "+ Önskelista";
    b.onclick = () => { if (onWish() !== false) b.outerHTML = `<span class="tip-done">Tillagd ✓</span>`; };
    act.appendChild(b);
  }
  if (onTips) {
    const t = document.createElement("button");
    t.className = "icon-btn tips-btn";
    t.setAttribute("aria-label", "Tips om " + title);
    t.innerHTML = ICON_TIPS;
    t.onclick = onTips;
    act.appendChild(t);
  }
  act.insertAdjacentHTML("beforeend", `<a class="icon-btn" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Öppna på Goodreads">${ICON_OPEN}</a>`);
  return el;
}

// ---------- Sök och statusfilter ----------
$("search").addEventListener("input", (e) => {
  query = e.target.value.trim();
  $("searchWrap").classList.toggle("has-text", !!e.target.value);
  renderList();
});
$("clearSearch").onclick = () => { $("search").value = ""; query = ""; $("searchWrap").classList.remove("has-text"); renderList(); };
$("statusGroup").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    $("statusGroup").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    statusFilter = b.dataset.s;
    renderList();
  };
});
window.addEventListener("online", () => { if (syncState === "offline") { syncState = "synkar …"; renderList(); } });
window.addEventListener("offline", () => { syncState = "offline"; renderList(); });

// ---------- Offline-stöd och start ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
refreshAll();
startFirebase();
