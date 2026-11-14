// Bibliotek – webbapp med Google-inloggning och synk via Firebase (Firestore).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------- Ikoner ----------
const ICON_READ = '<svg viewBox="0 0 24 24"><path d="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM10,17l-5,-5 1.41,-1.41L10,14.17l7.59,-7.59L19,8l-9,9z"/></svg>';
const ICON_UNREAD = '<svg viewBox="0 0 24 24"><path d="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM12,20c-4.42,0 -8,-3.58 -8,-8s3.58,-8 8,-8 8,3.58 8,8 -3.58,8 -8,8z"/></svg>';
const ICON_OPEN = '<svg viewBox="0 0 24 24"><path d="M19,19H5V5h7V3H5c-1.11,0 -2,0.9 -2,2v14c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2v-7h-2v7zM14,3v2h3.59l-9.83,9.83 1.41,1.41L19,6.41V10h2V3h-7z"/></svg>';
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
let app, auth, db, booksCol;
let unsubscribe = null;
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

  onAuthStateChanged(auth, (u) => {
    user = u;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!u) {
      books = [];
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

function refreshAll() { renderChips(); renderList(); renderMenu(); }

// ---------- Meny ----------
function renderMenu() {
  const m = $("menu");
  const items = [
    ["Skanna streckkod", startScan],
    ["Importera Excel", () => $("importInput").click()],
    ["Exportera Excel", chooseExport],
    ["Sortera", chooseSort],
  ];
  if (sortMode === "author") {
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
function editBook(book, prefill = null, prefillIsbn = "", fromScan = false) {
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
        if (!book) addBookDoc({ author, title, tags, read, isbn, added: Date.now() });
        else updateBookDoc(book.id, { author, title, tags, read, isbn });
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

$("addBtn").onclick = () => editBook(null);

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
  isbn: ["isbn", "isbn-13", "isbn13", "isbn-10", "isbn10"]
};
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
  const gCol = find(H.tags), sCol = find(H.status), iCol = find(H.isbn);
  const hasHeader = [aCol, tCol, gCol, sCol, iCol].some((x) => x !== null);
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
    out.push({ author, title, tags, read, isbn });
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
