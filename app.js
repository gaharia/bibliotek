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
import { getWorks, getSimilar, getOrigin, sameTitle, normName } from "./tips.js";

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

// Författare lagras i normal ordning ("Förnamn Efternamn") men visas och
// sorteras som "Efternamn, Förnamn". Namn som redan skrivits med kommatecken
// visas som de är.
const NAME_EXCEPTIONS = [
  // [normal ordning, visning]
  ["Gabriel García Márquez", "García Márquez, Gabriel"],
  ["Han Kang", "Han, Kang"],
  ["Ngũgĩ wa Thiong'o", "Ngũgĩ wa Thiong'o"]
];
const nameException = (a) => NAME_EXCEPTIONS.find(([n, d]) => normName(n) === normName(a) && (a.includes(",") === d.includes(",") || !a.includes(",")));
// Redaktörsmarkering, t.ex. "(red.)", flyttas sist och påverkar inte sorteringen.
const EDITOR_RE = /\s*\((red|reds|ed|eds|utg)\.?\)\s*$/i;
const splitEditor = (a) => { const m = a.match(EDITOR_RE); return m ? [a.slice(0, m.index).trim(), m[0].trim()] : [a, ""]; };
// Prefix som hör till efternamnet: "Ursula K. Le Guin" → "Le Guin, Ursula K.", "Daphne du Maurier" → "du Maurier, Daphne".
// Småskrivna "de", "von", "van" stannar efter förnamnet enligt bibliotekspraxis: "Beauvoir, Simone de".
const SURNAME_PREFIX = /^(le|la|les|du|des|Le|La|Les|Du|Des|De|Di|Da|Del|Della|Van|Von|Ten|Ter|Mac|Mc|St\.?)$/;
function invertOne(a) {
  if (a.includes(",")) return a;
  const p = a.split(" ");
  if (p.length === 1) return a;
  // Suffix som "Jr." följer med förnamnet.
  let last = p.length - 1;
  if (/^(jr|sr|d\.?\s?y|d\.?\s?ä|ii|iii)\.?$/i.test(p[last]) && last > 1) last--;
  let start = last;
  while (start - 1 >= 1 && SURNAME_PREFIX.test(p[start - 1])) start--;
  return `${p.slice(start, last + 1).join(" ")}, ${p.slice(0, start).concat(p.slice(last + 1)).join(" ")}`;
}
function displayAuthor(name) {
  const [a, ed] = splitEditor(String(name || "").trim().replace(/\s+/g, " "));
  if (!a) return ed;
  const tail = ed ? " " + ed : "";
  const ex = nameException(a);
  if (ex) return ex[1] + tail;
  const multi = a.match(/^(.+?)(\s*(?:,|&|\soch\s|\sand\s)\s*)(.+)$/i);
  if (multi && /\s(&|och|and)\s/i.test(a)) {
    if (multi[1].includes(" ")) {
      // Flera fullständiga namn: "Anders Burman & Anders Bartonek" → "Burman, Anders & Anders Bartonek"
      return invertOne(multi[1]) + multi[2] + multi[3] + tail;
    }
    // Delat efternamn: "Charlotte, Emily & Anne Brontë" → "Brontë, Charlotte, Emily & Anne"
    const m = a.match(/^(.*\S)\s+(\S+)$/);
    return (m ? `${m[2]}, ${m[1]}` : a) + tail;
  }
  return invertOne(a) + tail;
}
// Omvänt: "Efternamn, Förnamn" → "Förnamn Efternamn" (för sökningar och jämförelser).
function naturalName(name) {
  const a = splitEditor(String(name || "").trim())[0];
  const ex = nameException(a);
  if (ex) return ex[0];
  if (/&|\soch\s/i.test(a)) return a;
  const m = a.match(/^([^,]+),\s*([^,]+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : a;
}
// "Antologi", "Diverse", "Okänd" m.fl. är inga författarnamn och hamnar sist i listan.
function authorSortKey(b) {
  const a = (b.author || "").trim();
  if (!a) return "\uffff\uffff";
  if (ANTHOLOGY.includes(normName(a))) return "\uffff" + a;
  return displayAuthor(a);
}
const groupKey = (b) => normName(naturalName(b.author)) || (b.author || "").trim().toLowerCase();
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
const LANGS = ["Svenska", "Engelska", "Ryska", "Övrigt"];
const READERS = ["David", "Felicia"];
// Metataggar visas som egen rad; övriga taggar och ursprung finns i filterpanelen.
const META = ["Skönlitteratur", "Sakprosa", "Fiktion", "Serier", "Poesi"];
const ORIGINS = ["Svenskt", "Nordiskt", "Brittiskt", "Amerikanskt", "Övrigt engelskspråkigt", "Ryskt", "Östeuropeiskt",
  "Franskt", "Tyskspråkigt", "Italienskt", "Latinamerikanskt", "Afrikanskt", "Mellanöstern", "Asiatiskt", "Antiken", "Övrigt/Okänd"];
// Politisk sakprosa: Sakprosa med någon av taggarna Socialism, Anarkism eller Antikolonialism.
const POLITICAL_TAGS = ["Socialism", "Anarkism", "Antikolonialism"];
function politicsOnly(b) {
  return b.tags.includes("Sakprosa") && b.tags.some((t) => POLITICAL_TAGS.includes(t));
}
function normLang(v) {
  const x = String(v || "").trim().toLowerCase();
  if (!x) return "";
  if (["sv", "swe", "svenska", "swedish"].includes(x)) return "Svenska";
  if (["en", "eng", "engelska", "english"].includes(x)) return "Engelska";
  if (["ru", "rus", "ryska", "russian"].includes(x)) return "Ryska";
  return "Övrigt";
}
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
// Önskelistan har två delar: Skönlitteratur och Sakprosa. Äldre önskningar utan del räknas som Skönlitteratur.
const WISH_KINDS = ["Skönlitteratur", "Sakprosa"];
let wishKind = "Skönlitteratur";
const kindFromTags = (tags) => ((tags || []).some((t) => normName(t) === "sakprosa") ? "Sakprosa" : "Skönlitteratur");
function wishFromDoc(id, d) {
  return { id, author: String(d.author || ""), title: String(d.title || ""), note: String(d.note || ""), added: Number(d.added) || 0,
    kind: WISH_KINDS.includes(d.kind) ? d.kind : "Skönlitteratur", isbn: String(d.isbn || "") };
}

function fromDoc(id, d) {
  return {
    id,
    author: String(d.author || ""),
    title: String(d.title || ""),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    read: !!d.read,
    isbn: String(d.isbn || ""),
    added: Number(d.added) || 0,
    pages: Number(d.pages) || 0,
    language: String(d.language || ""),
    note: String(d.note || ""),
    readBy: Array.isArray(d.readBy) ? d.readBy.map(String) : [],
    origin: Array.isArray(d.origin) ? d.origin.map(String) : [],
    year: Number(d.year) || 0
  };
}
// Databasreglerna har gränser (t.ex. högst 3000 tecken anteckning, 50 taggar, 10 ursprung).
// En enda bok över gränsen skulle stoppa en hel import, så värdena kortas av innan de sparas.
const LIMITS = { author: 300, title: 500, isbn: 20, language: 20, note: 3000, tags: 50, origin: 10, readBy: 2 };
const clip = (v, n) => String(v ?? "").slice(0, n);
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x) : 0; };
function cleanFields(f) {
  const o = { ...f };
  for (const k of ["author", "title", "isbn", "language", "note"]) if (k in o) o[k] = clip(o[k], LIMITS[k]);
  if ("tags" in o) o.tags = [...new Set((o.tags || []).map((t) => clip(t, 100)).filter(Boolean))].slice(0, LIMITS.tags);
  if ("origin" in o) o.origin = [...new Set((o.origin || []).map((t) => clip(t, 100)).filter(Boolean))].slice(0, LIMITS.origin);
  if ("readBy" in o) o.readBy = [...new Set(o.readBy || [])].filter((n) => READERS.includes(n)).slice(0, LIMITS.readBy);
  if ("pages" in o) o.pages = Math.max(0, num(o.pages));
  if ("year" in o) o.year = num(o.year);
  if ("read" in o) o.read = !!o.read;
  return o;
}
function toData(b) {
  return cleanFields({
    author: b.author, title: b.title, tags: b.tags, read: !!b.read,
    isbn: b.isbn || "", added: b.added || Date.now(), updatedBy: user ? user.email : "",
    pages: b.pages, language: b.language || "", note: b.note || "", readBy: b.readBy || [], origin: b.origin || [], year: b.year
  });
}
// Skrivningar sparas lokalt direkt och synkas när det finns nät.
function writeFailed(err) { toast("Kunde inte spara: " + (err && err.message ? err.message : err)); }
function addBookDoc(b) { const ref = doc(booksCol); setDoc(ref, toData(b)).catch(writeFailed); return ref.id; }
function updateBookDoc(id, fields) {
  updateDoc(doc(booksCol, id), cleanFields({ ...fields, updatedBy: user ? user.email : "" })).catch(writeFailed);
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
const selectedTags = new Set();     // övriga taggar (alla måste finnas)
const selectedMeta = new Set(["Skönlitteratur"]); // metataggar (någon av dem) – Skönlitteratur är förvald vid start
const selectedOrigins = new Set();  // ursprung (något av dem)
let includePolitics = false;
const excludedTags = new Set();     // taggar som filtreras bort (andra trycket i filterpanelen)
const excludedOrigins = new Set();  // ursprung som filtreras bort
let sortMode = "author";
let statusFilter = "all";
let statusReader = null; // null = vem som helst, annars "David"/"Felicia"
let langFilter = "all";
// Okänt språk räknas som Övrigt.
const langOf = (b) => (["Svenska", "Engelska", "Ryska"].includes(b.language) ? b.language : "Övrigt");
const expanded = new Set();
let currentSelection = [];

function tagCounts() {
  const m = new Map();
  for (const b of books) for (const t of b.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => collator.compare(a[0], b[0]));
}
function originCounts() {
  const m = new Map();
  for (const b of books) for (const o of b.origin) m.set(o, (m.get(o) || 0) + 1);
  const rank = (o) => { const i = ORIGINS.indexOf(o); return i < 0 ? 99 : i; };
  return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || collator.compare(a[0], b[0]));
}
// Titlar jämförs "naturligt": Del 2 före Del 10, och romerska siffror (Anna Karenina II) som tal.
const natCollator = new Intl.Collator("sv", { sensitivity: "accent", numeric: true });
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanToInt(r) { let n = 0; for (let i = 0; i < r.length; i++) { const v = ROMAN[r[i]], w = ROMAN[r[i + 1]] || 0; n += v < w ? -v : v; } return n; }
const natTitle = (t) => String(t || "").replace(/\b([ivxlc]+)\b/gi, (m) => /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xx|xxx|l|c)$/i.test(m) ? String(romanToInt(m.toLowerCase())).padStart(3, "0") : m);
const titleCmp = (a, b) => natCollator.compare(natTitle(a.title), natTitle(b.title));
// Inom en författare: utgivningsår först (så bokserier som Wheel of Time hamnar i ordning), böcker utan år sist.
const yearCmp = (a, b) => (a.year || 99999) - (b.year || 99999);
const authorCmp = (a, b) => collator.compare(authorSortKey(a), authorSortKey(b)) || yearCmp(a, b) || titleCmp(a, b);

function matches(b, q) {
  if (selectedMeta.size && !b.tags.some((t) => selectedMeta.has(t))) return false;
  if (selectedMeta.has("Sakprosa") && !includePolitics && politicsOnly(b)) return false;
  if (selectedOrigins.size && !b.origin.some((o) => selectedOrigins.has(o))) return false;
  if (excludedOrigins.size && b.origin.some((o) => excludedOrigins.has(o))) return false;
  if (excludedTags.size && b.tags.some((t) => excludedTags.has(t))) return false;
  for (const t of selectedTags) if (!b.tags.includes(t)) return false;
  if (statusFilter === "read" && !(statusReader ? (b.readBy || []).includes(statusReader) : b.read)) return false;
  if (statusFilter === "unread" && (statusReader ? (b.readBy || []).includes(statusReader) : b.read)) return false;
  if (langFilter !== "all" && langOf(b) !== langFilter) return false;
  if (!q) return true;
  return b.author.toLowerCase().includes(q) || displayAuthor(b.author).toLowerCase().includes(q) || b.title.toLowerCase().includes(q) ||
    (b.isbn || "").includes(q) || b.tags.some((t) => t.toLowerCase().includes(q)) || b.origin.some((o) => o.toLowerCase().includes(q)) ||
    (b.note || "").toLowerCase().includes(q) || (b.readBy || []).some((n) => n.toLowerCase().includes(q));
}

// ---------- Rendering ----------
function renderChips() {
  const counts = new Map(tagCounts());
  const origins = new Map(originCounts());
  for (const t of [...selectedTags]) if (!counts.has(t)) selectedTags.delete(t);
  for (const o of [...selectedOrigins]) if (!origins.has(o)) selectedOrigins.delete(o);
  for (const t of [...excludedTags]) if (!counts.has(t)) excludedTags.delete(t);
  for (const o of [...excludedOrigins]) if (!origins.has(o)) excludedOrigins.delete(o);
  // Rad 3: metataggar
  const el = $("chips");
  el.style.display = books.length ? "flex" : "none";
  el.innerHTML = "";
  const chip = (label, on, onclick, cls = "") => {
    const c = document.createElement("button");
    c.className = "chip" + (on ? " on" : "") + (cls ? " " + cls : "");
    c.textContent = label;
    c.onclick = onclick;
    el.appendChild(c);
    return c;
  };
  // Inget valt = alla böcker. Raden bryts vid behov så att alla metataggar får plats.
  for (const m of META) {
    const c = chip(m, selectedMeta.has(m), () => {
      selectedMeta.has(m) ? selectedMeta.delete(m) : selectedMeta.add(m); renderChips(); renderList();
    });
    c.insertAdjacentHTML("beforeend", `<small>${counts.get(m) || 0}</small>`);
    if (m === "Sakprosa" && selectedMeta.has("Sakprosa")) {
      const n = books.filter(politicsOnly).length;
      const t = chip(`Inkl. politik ${n}`, includePolitics, () => { includePolitics = !includePolitics; renderChips(); renderList(); }, "toggle");
      t.title = "Sakprosa med taggen Socialism, Anarkism eller Antikolonialism";
    }
  }
  // Rad 4: aktiva filter från filterpanelen
  const act = $("activeFilters");
  const active = [
    ...(langFilter !== "all" ? [["l", langFilter]] : []),
    ...[...selectedOrigins].map((o) => ["o", o]), ...[...excludedOrigins].map((o) => ["xo", o]),
    ...[...selectedTags].map((t) => ["t", t]), ...[...excludedTags].map((t) => ["xt", t])];
  act.style.display = active.length ? "flex" : "none";
  act.innerHTML = "";
  const sets = { o: selectedOrigins, t: selectedTags, xo: excludedOrigins, xt: excludedTags };
  for (const [k, v] of active) {
    const c = document.createElement("button");
    c.className = "chip removable " + (k.startsWith("x") ? "excluded" : "on");
    c.textContent = (k.startsWith("x") ? "Ej " : "") + v + " ✕";
    c.onclick = () => { if (k === "l") langFilter = "all"; else sets[k].delete(v); renderChips(); renderList(); };
    act.appendChild(c);
  }
  if (active.length > 1) {
    const r = document.createElement("button");
    r.className = "btn-text small";
    r.textContent = "Rensa";
    r.onclick = clearFilters;
    act.appendChild(r);
  }
  const badge = $("filterBadge");
  badge.textContent = active.length || "";
  badge.style.display = active.length ? "" : "none";
  $("filterBtn").classList.toggle("on", active.length > 0);
}

function clearFilters() {
  selectedOrigins.clear(); selectedTags.clear(); excludedOrigins.clear(); excludedTags.clear(); langFilter = "all";
  renderChips(); renderList();
}
// Filterpanel: Språk, Ursprung (något av) och Taggar (alla valda).
// Tryck en gång = visa bara dessa, två gånger = filtrera bort dem, tre gånger = av.
function openFilters() {
  const body = document.createElement("div");
  body.className = "filters";
  const draw = () => {
    body.innerHTML = "";
    const head = (title, hint) => {
      const h = document.createElement("div");
      h.className = "f-head";
      h.innerHTML = `<span>${esc(title)}</span><small>${esc(hint)}</small>`;
      body.appendChild(h);
    };
    const refresh = () => { draw(); renderChips(); renderList(); };
    // Språk: ett val åt gången
    head("Språk", "");
    const lg = document.createElement("div");
    lg.className = "sugg";
    const lc = new Map();
    for (const b of books) lc.set(langOf(b), (lc.get(langOf(b)) || 0) + 1);
    for (const [v, label] of [["all", "Alla"], ...["Svenska", "Engelska", "Ryska", "Övrigt"].map((x) => [x, `${x} (${lc.get(x) || 0})`])]) {
      const c = document.createElement("button");
      c.className = "chip" + (langFilter === v ? " on" : "");
      c.textContent = label;
      c.onclick = () => { langFilter = v; refresh(); };
      lg.appendChild(c);
    }
    body.appendChild(lg);
    const section = (title, hint, entries, inc, exc) => {
      head(title, hint);
      const g = document.createElement("div");
      g.className = "sugg";
      for (const [v, n] of entries) {
        const c = document.createElement("button");
        const st = inc.has(v) ? "on" : exc.has(v) ? "excluded" : "";
        c.className = "chip " + st;
        c.textContent = (st === "excluded" ? "Ej " : "") + `${v} (${n})`;
        c.onclick = () => {
          if (inc.has(v)) { inc.delete(v); exc.add(v); }
          else if (exc.has(v)) exc.delete(v);
          else inc.add(v);
          refresh();
        };
        g.appendChild(c);
      }
      if (!entries.length) g.innerHTML = `<p class="muted">Inga ännu.</p>`;
      body.appendChild(g);
    };
    section("Ursprung", "1 tryck: visa · 2: dölj · 3: av", originCounts(), selectedOrigins, excludedOrigins);
    const tags = tagCounts().filter(([t]) => !META.includes(t)).sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
    section("Taggar", "1 tryck: visa (alla valda) · 2: dölj · 3: av", tags, selectedTags, excludedTags);
    const n = selectedOrigins.size + selectedTags.size + excludedOrigins.size + excludedTags.size + (langFilter !== "all" ? 1 : 0);
    const res = document.createElement("p");
    res.className = "muted";
    res.textContent = `${books.filter((b) => matches(b, query.toLowerCase())).length} böcker matchar`;
    body.appendChild(res);
    if (n) {
      const r = document.createElement("button");
      r.className = "btn-text small";
      r.textContent = "Rensa filter";
      r.onclick = () => { clearFilters(); draw(); };
      body.appendChild(r);
    }
  };
  draw();
  dialog({ title: "Filter", body, buttons: [{ label: "Klar" }] });
}

// Läst-knappen utgår från den som läser på enheten: grön = jag har läst, gul = bara den andra, grå = ingen.
function readState(b) {
  const me = currentReader(), by = b.readBy || [];
  if (me && by.includes(me)) return "me";
  if (b.read) return me ? "other" : "me";
  return "none";
}
function readButton(b) {
  const st = readState(b), me = currentReader();
  const others = (b.readBy || []).filter((n) => n !== me);
  const label = st === "me" ? "Markera som oläst för " + (me || "dig") : st === "other" ? `Läst av ${others.join(" och ") || "någon annan"} – markera som läst av ${me}` : "Markera som läst";
  return `<button class="icon-btn read-btn ${st === "me" ? "on" : st === "other" ? "other" : ""}" aria-label="${esc(label)}" title="${esc(label)}">${st === "none" ? ICON_UNREAD : ICON_READ}</button>`;
}
function bookRow(b, grouped) {
  const row = document.createElement("div");
  row.className = "row" + (grouped ? " grouped" : "");
  const showAuthor = !grouped && b.author;
  const meta = [b.language, b.origin.join(", "), b.year ? String(b.year) : "", b.pages ? b.pages + " s." : "", (b.readBy || []).length ? "Läst av " + b.readBy.join(" och ") : ""].filter(Boolean).join(" · ");
  row.innerHTML = `<div class="txt"><div class="t">${esc(b.title || "Utan titel")}</div>` +
    (showAuthor ? `<div class="a">${esc(displayAuthor(b.author))}</div>` : "") +
    (meta ? `<div class="m">${esc(meta)}</div>` : "") +
    (b.note ? `<div class="nt">${esc(b.note.length > 90 ? b.note.slice(0, 90) + " …" : b.note)}</div>` : "") +
    (b.tags.length ? `<div class="g">${esc(b.tags.join("  ·  "))}</div>` : "") + `</div>` +
    readButton(b) +
    `<a class="icon-btn" href="${esc(goodreadsUrl(b))}" target="_blank" rel="noopener" aria-label="Öppna på Goodreads">${ICON_OPEN}</a>`;
  row.onclick = () => editBook(b);
  row.querySelector(".read-btn").onclick = (e) => { e.stopPropagation(); toggleRead(b); };
  row.querySelector("a").onclick = (e) => e.stopPropagation();
  return row;
}

// "2 böcker · 3 noveller · 1 läst": noveller (taggen Noveller) räknas för sig.
function groupCounts(list) {
  const shorts = list.filter((b) => b.tags.includes("Noveller")).length, nb = list.length - shorts;
  const read = list.filter((x) => x.read).length;
  return [nb ? (nb === 1 ? "1 bok" : `${nb} böcker`) : "", shorts ? (shorts === 1 ? "1 novell" : `${shorts} noveller`) : "",
    `${read} ${read === 1 ? "läst" : "lästa"}`].filter(Boolean).join(" · ");
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
      h.innerHTML = `${ICON_CHEV}<div class="n">${esc(displayAuthor(gb[0].author) || "Okänd författare")}</div>` +
        `<div class="c">${groupCounts(gb)}</div>`;
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
  $("statusGroup").style.display = wish ? "none" : "";

  $("filterBtn").style.display = wish ? "none" : "";
  if (wish) { renderWishChips(); $("activeFilters").style.display = "none"; } else renderChips();
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
    [`Hämta sidantal och år (${books.filter(needsFill).length} saknas)`, fetchAllPages],
    [`Läsare på den här enheten: ${currentReader() || "inte vald"}`, () => askReader(() => refreshAll())],
  ];
  const oldOrigin = books.filter((b) => b.tags.some((t) => ORIGINS.includes(t))).length;
  if (!wish && oldOrigin) items.push([`Flytta ursprungstaggar till Ursprung (${oldOrigin})`, migrateOriginTags]);
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
function suggestions(container, labelText, onPick, exclude = []) {
  const tags = tagCounts().map((c) => c[0]).filter((t) => !exclude.includes(t));
  if (!tags.length) return;
  const l = document.createElement("div");
  l.className = "sugg-label";
  l.textContent = labelText;
  const g = document.createElement("div");
  g.className = "sugg sugg-tags";
  for (const t of tags) {
    const c = document.createElement("button");
    c.className = "chip";
    c.textContent = t;
    c.dataset.tag = t;
    c.onclick = () => onPick(t);
    g.appendChild(c);
  }
  container.append(l, g);
}

// ---------- Läst / oläst ----------
// Vem som läser: valet som sparats på enheten, annars förnamnet i det inloggade Google-kontot.
const READER_KEY = "bibliotek-reader";
function currentReader() {
  try { const s = localStorage.getItem(READER_KEY); if (READERS.includes(s)) return s; } catch (e) {}
  const dn = ((user && user.displayName) || "").trim().toLowerCase();
  return READERS.find((n) => dn.startsWith(n.toLowerCase())) || null;
}
function askReader(then) {
  choiceDialog("Vem läser på den här enheten?", READERS.map((n) => [n, n]), currentReader(), (n) => {
    try { localStorage.setItem(READER_KEY, n); } catch (e) {}
    if (then) then(n);
  });
}
function withReader(fn) { const r = currentReader(); if (r) fn(r); else askReader(fn); }

function toggleRead(b) {
  const prev = { read: b.read, readBy: [...(b.readBy || [])] };
  withReader((me) => {
    const by = b.readBy || [];
    let readBy, read, msg;
    if (by.includes(me)) {
      // Ta bort mig; boken är fortfarande läst om någon annan har läst den.
      readBy = by.filter((n) => n !== me);
      read = readBy.length > 0;
      msg = `”${b.title}” markerad som oläst för ${me}`;
    } else {
      readBy = [...by, me];
      read = true;
      msg = `”${b.title}” markerad som läst av ${me}`;
    }
    updateBookDoc(b.id, { read, readBy });
    snackbar(msg, "Ångra", () => updateBookDoc(b.id, prev));
  });
}

// ---------- Lägg till / redigera ----------
function editBook(book, prefill = null, prefillIsbn = "", fromScan = false, fromWishId = null) {
  const body = document.createElement("div");
  const fA = field("Författare", book ? book.author : (prefill?.author || ""), 'maxlength="300"');
  const fT = field("Titel", book ? book.title : (prefill?.title || ""), 'maxlength="500"');
  const fI = field("ISBN", book ? (book.isbn || "") : prefillIsbn, 'inputmode="numeric"');
  const sw = document.createElement("div");
  sw.className = "switch-row";
  let read = book ? !!book.read : false; // Oläst är standard
  sw.innerHTML = `<span>Läst</span><div class="switch${read ? " on" : ""}" role="switch" aria-checked="${read}"></div>`;
  let syncWho = () => {};
  sw.onclick = (e) => {
    read = !read; sw.lastChild.classList.toggle("on", read); sw.lastChild.setAttribute("aria-checked", read);
    if (!e || e.isTrusted === false) return;
    if (read && !readBy.length) { const r = currentReader(); if (r) readBy = [r]; }
    if (!read) readBy = [];
    syncWho();
  };
  // Läst av (valfritt): att välja en person markerar boken som läst.
  let readBy = book ? [...(book.readBy || [])] : [];
  const who = document.createElement("div");
  who.className = "who";
  who.innerHTML = `<span>Läst av (valfritt)</span>`;
  READERS.forEach((name) => {
    const c = document.createElement("button");
    c.className = "chip" + (readBy.includes(name) ? " on" : "");
    c.textContent = name;
    c.onclick = () => {
      readBy = readBy.includes(name) ? readBy.filter((n) => n !== name) : [...readBy, name];
      c.classList.toggle("on", readBy.includes(name));
      if (readBy.length && !read) { read = true; sw.lastChild.classList.add("on"); sw.lastChild.setAttribute("aria-checked", true); }
    };
    who.appendChild(c);
  });
  syncWho = () => who.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", readBy.includes(c.textContent)));
  const fG = document.createElement("div");
  fG.className = "field";
  fG.innerHTML = `<label>Taggar (separera med kommatecken)</label><textarea class="tags-input" rows="1"></textarea>`;
  fG.querySelector("textarea").value = book ? book.tags.join(", ") : (prefill?.tags || []).join(", ");
  // Ursprung (författarens), ett eller flera
  let origin = book ? [...book.origin] : [...(prefill?.origin || [])];
  const fO = document.createElement("div");
  fO.className = "field origin-field";
  fO.innerHTML = `<label>Ursprung (författarens)</label><div class="sugg"></div><button class="btn-text small fetch-origin">Hämta ursprung</button>`;
  const oBox = fO.querySelector(".sugg");
  const drawOrigins = () => {
    oBox.innerHTML = "";
    const all = [...new Set([...ORIGINS, ...originCounts().map((x) => x[0]), ...origin])];
    for (const o of all) {
      const c = document.createElement("button");
      c.className = "chip" + (origin.includes(o) ? " on" : "");
      c.textContent = o;
      c.onclick = () => {
        if (!origin.includes(o) && origin.length >= LIMITS.origin) { toast(`Högst ${LIMITS.origin} ursprung`); return; }
        origin = origin.includes(o) ? origin.filter((x) => x !== o) : [...origin, o]; drawOrigins();
      };
      oBox.appendChild(c);
    }
  };
  drawOrigins();
  // Språk och sidantal
  const langRow = document.createElement("div");
  langRow.className = "field-row";
  const lang0 = book ? book.language : (prefill?.language || "");
  langRow.innerHTML = `<div class="field"><label>Språk</label><select>${LANGS.map((l) => `<option value="${l}"${l === (LANGS.includes(lang0) ? lang0 : "Övrigt") ? " selected" : ""}>${l}</option>`).join("")}</select></div>` +
    `<div class="field"><label>Sidor</label><input class="in-pages" inputmode="numeric" value="${(book ? book.pages : prefill?.pages) || ""}"></div>` +
    `<div class="field"><label>Utgiven</label><input class="in-year" inputmode="numeric" placeholder="år" value="${(book ? book.year : prefill?.year) || ""}"></div>` +
    `<button class="btn-text small fetch-pages">Hämta sidor och år</button>`;
  const selLang = langRow.querySelector("select"), inP = langRow.querySelector(".in-pages"), inY = langRow.querySelector(".in-year");
  const fNote = document.createElement("div");
  fNote.className = "field";
  fNote.innerHTML = `<label>Anteckning</label><textarea rows="3" maxlength="3000"></textarea>`;
  const inNote = fNote.querySelector("textarea");
  inNote.value = book ? (book.note || "") : "";
  body.append(fA, fT, fI, langRow, fO, sw, who, fG, fNote);
  const inA = fA.querySelector("input"), inT = fT.querySelector("input"), inI = fI.querySelector("input"), inG = fG.querySelector("textarea");
  // Taggrutan växer med texten; Enter ger inte ny rad.
  const growTags = () => { inG.style.height = "auto"; inG.style.height = inG.scrollHeight + 2 + "px"; };
  inG.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
  const fetchBtn = langRow.querySelector(".fetch-pages");
  fetchBtn.onclick = async () => {
    fetchBtn.textContent = "Söker …"; fetchBtn.disabled = true;
    const q = { isbn: normalizeIsbn(inI.value), title: inT.value.trim(), author: inA.value.trim() };
    const [n, y] = await Promise.all([inP.value ? null : fetchPages(q).catch(() => null), inY.value ? null : fetchYear(q).catch(() => null)]);
    fetchBtn.disabled = false;
    if (n) inP.value = n;
    if (y) inY.value = y;
    fetchBtn.textContent = n || y || (inP.value && inY.value) ? "Hämta sidor och år" : "Hittade inget";
  };
  // Ursprung: samma som författarens andra böcker, annars Wikidata.
  const sameAuthorOrigin = (a) => { const o = books.find((x) => x.origin.length && sameAuthor(x.author, a)); return o ? o.origin : null; };
  const fetchO = fO.querySelector(".fetch-origin");
  fetchO.onclick = async () => {
    const a = inA.value.trim();
    if (!a) { toast("Fyll i författare först"); return; }
    const known = sameAuthorOrigin(a);
    if (known) { origin = [...known]; drawOrigins(); return; }
    fetchO.textContent = "Söker …"; fetchO.disabled = true;
    const o = await getOrigin(naturalName(a)).catch(() => []);
    fetchO.disabled = false;
    fetchO.textContent = o.length ? "Hämta ursprung" : "Hittade inget";
    if (o.length) { origin = o; drawOrigins(); }
  };
  inA.addEventListener("change", () => { if (!origin.length) { const k = sameAuthorOrigin(inA.value.trim()); if (k) { origin = [...k]; drawOrigins(); } } });
  // Föreslagna taggar: de som redan är med är markerade, tryck igen för att ta bort.
  const markTags = () => {
    const cur = parseTags(inG.value).map((x) => x.toLowerCase());
    body.querySelectorAll(".sugg-tags .chip").forEach((c) => c.classList.toggle("on", cur.includes(c.dataset.tag.toLowerCase())));
  };
  // Metataggar för sig (minst en krävs för nya böcker), övriga taggar under.
  const toggleTag = (t) => {
    const cur = parseTags(inG.value);
    const has = cur.some((x) => x.toLowerCase() === t.toLowerCase());
    inG.value = (has ? cur.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...cur, t]).join(", ");
    markTags(); growTags();
  };
  {
    const lab = document.createElement("div");
    lab.className = "sugg-label";
    lab.textContent = book ? "Metataggar" : "Metataggar – välj minst en";
    const g = document.createElement("div");
    g.className = "sugg sugg-tags sugg-meta";
    for (const t of META) {
      const c = document.createElement("button");
      c.className = "chip"; c.textContent = t; c.dataset.tag = t;
      c.onclick = () => toggleTag(t);
      g.appendChild(c);
    }
    body.append(lab, g);
  }
  suggestions(body, "Övriga taggar – tryck för att lägga till eller ta bort", toggleTag, META);
  inG.addEventListener("input", () => { markTags(); growTags(); });
  markTags();
  requestAnimationFrame(growTags);
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
        if (!author && !title) { toast("Fyll i författare eller titel"); return false; }
        const tags = parseTags(inG.value), isbn = normalizeIsbn(inI.value);
        if (!book && !tags.some((t) => META.includes(t))) {
          toast("Välj minst en metatagg: " + META.join(", "));
          body.querySelector(".sugg-meta")?.scrollIntoView({ block: "center", behavior: "smooth" });
          return false;
        }
        const pages = parseInt(inP.value, 10) || 0, language = selLang.value, note = inNote.value.trim();
        const year = parseInt(inY.value, 10) || 0;
        if (!read) readBy = [];
        if (!book) {
          addBookDoc({ author, title, tags, read, isbn, added: Date.now(), pages, language, note, readBy, origin, year });
          if (fromWishId) { deleteWish(fromWishId); toast(`”${title}” flyttad från önskelistan till biblioteket`); }
          else setTimeout(() => checkWishAfterAdd(author, title), 300);
        } else updateBookDoc(book.id, { author, title, tags, read, isbn, pages, language, note, readBy, origin, year });
        expanded.add(groupKey({ author }));
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
// Radera alla: först ett obligatoriskt val om säkerhetskopia, sedan en bekräftelse där man skriver RADERA.
function confirmDeleteAll() {
  if (!books.length) return;
  const n = books.length;
  dialog({ title: "Säkerhetskopia först?",
    body: `Du är på väg att radera alla ${n} böcker för er båda. Vill du ladda ner en säkerhetskopia (Excel) innan?`,
    buttons: [
      { label: "Avbryt" },
      { label: "Utan kopia", action: () => setTimeout(() => finalDeleteAll(false), 50) },
      { label: "Ladda ner kopia", action: () => { exportBooks(books.slice().sort(authorCmp)); setTimeout(() => finalDeleteAll(true), 600); } }
    ] });
}
function finalDeleteAll(backedUp) {
  const body = document.createElement("div");
  body.innerHTML = `<p>${backedUp ? "Säkerhetskopian är nedladdad." : "<b>Ingen säkerhetskopia tas.</b>"} Raderingen gäller båda era telefoner och går inte att ångra.</p>
    <p>Skriv <b>RADERA</b> för att bekräfta.</p>`;
  const f = field("Bekräfta");
  body.appendChild(f);
  const inp = f.querySelector("input");
  dialog({ title: `Radera alla ${books.length} böcker`, body, buttons: [
    { label: "Avbryt" },
    { label: "Radera allt", action: () => {
      if (inp.value.trim().toUpperCase() !== "RADERA") { toast("Skriv RADERA för att bekräfta"); return false; }
      runBatches(books.map((b) => (batch) => batch.delete(doc(booksCol, b.id))));
      toast("Alla böcker raderade");
    } }
  ] });
  setTimeout(() => inp.focus(), 100);
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
      editWish(null, { ...(res || (existing ? { author: existing.author, title: existing.title } : {})), isbn });
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
// Ursprung vid skanning: författarens andra böcker i biblioteket först, annars Wikidata (max 10 s).
async function lookupOrigin(author) {
  if (!author) return [];
  const own = books.find((x) => x.origin.length && sameAuthor(x.author, author));
  if (own) return [...own.origin];
  return Promise.race([getOrigin(author).catch(() => []), new Promise((r) => setTimeout(() => r([]), 10000))]);
}
async function lookup(isbn) {
  const sources = [
    async () => { const j = await getJson(`https://libris.kb.se/xsearch?query=isbn:${isbn}&format=json&n=1`);
      const o = j?.xsearch?.list?.[0]; return o ? { author: invertName(first(o.creator)), title: first(o.title).split(" / ")[0].trim(), language: normLang(first(o.language)) } : null; },
    async () => { const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      const v = j?.items?.[0]?.volumeInfo; return v ? { author: (v.authors || [""])[0], title: v.title || "", language: normLang(v.language), pages: v.pageCount || 0 } : null; },
    async () => { const j = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const o = j?.["ISBN:" + isbn]; return o ? { author: o.authors?.[0]?.name || "", title: o.title || "", pages: o.number_of_pages || 0 } : null; }
  ];
  let found = null;
  for (const s of sources) { try { const r = await s(); if (r && r.title) { found = r; break; } } catch (e) {} }
  if (found) {
    const [pages, origin, year] = await Promise.all([
      found.pages ? found.pages : Promise.race([fetchPages({ isbn, title: found.title, author: found.author }).catch(() => 0), new Promise((r) => setTimeout(() => r(0), 10000))]),
      lookupOrigin(found.author),
      Promise.race([fetchYear(found).catch(() => null), new Promise((r) => setTimeout(() => r(null), 10000))])
    ]);
    found.pages = pages || 0;
    found.origin = origin;
    found.year = year || 0;
  }
  return found;
}

// Utgivningsår (första utgåvan av verket): Wikidata via författarens verk (titlar på flera språk),
// annars Open Library (first_publish_year).
async function fetchYear({ title, author }) {
  if (!title) return null;
  const a = author && !ANTHOLOGY.includes(normName(author)) ? authorNames(naturalName(author))[0] : "";
  if (a) {
    try {
      const w = await getWorks(a);
      const hit = w.works.find((x) => x.year && (x.titles && x.titles.length ? x.titles : [x.title]).some((t) => sameTitle(title, t)));
      if (hit) return Number(hit.year);
    } catch (e) {}
  }
  const q = `title=${encodeURIComponent(title)}` + (a ? `&author=${encodeURIComponent(a)}` : "");
  const s = await getJson(`https://openlibrary.org/search.json?${q}&fields=title,first_publish_year&limit=5`);
  const ys = (s?.docs || []).map((x) => x.first_publish_year).filter(Boolean);
  return ys.length ? Math.min(...ys) : null;
}

// Sidantal: Open Library (ISBN), Google Books (ISBN), sedan Open Library via titel + författare (medianvärde av utgåvorna).
async function fetchPages({ isbn, title, author }) {
  if (isbn) {
    const o = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const n1 = o?.["ISBN:" + isbn]?.number_of_pages; if (n1) return n1;
    const g = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const n2 = g?.items?.[0]?.volumeInfo?.pageCount; if (n2) return n2;
  }
  if (title) {
    const q = `title=${encodeURIComponent(title)}` + (author ? `&author=${encodeURIComponent(author)}` : "");
    const s = await getJson(`https://openlibrary.org/search.json?${q}&fields=title,number_of_pages_median&limit=3`);
    const d = (s?.docs || []).find((x) => x.number_of_pages_median);
    if (d) return d.number_of_pages_median;
  }
  return null;
}

// Hämtar saknade sidantal och utgivningsår i bakgrunden. Varje träff sparas direkt,
// så det som hunnit hämtas finns kvar även om appen stängs.
const needsFill = (b) => !b.pages || !b.year;
function fetchAllPages() {
  const missing = books.filter(needsFill);
  if (!missing.length) { toast("Alla böcker har redan sidantal och år"); return; }
  backgroundPages(missing);
}
let bgPagesRunning = false;
async function backgroundPages(list) {
  if (bgPagesRunning) { toast("Hämtning pågår redan"); return; }
  if (!list.length) return;
  bgPagesRunning = true;
  let cancelled = false, done = 0, found = 0;
  const pill = document.createElement("div");
  pill.className = "bgjob";
  pill.innerHTML = `<div class="spinner"></div><span></span><button aria-label="Avbryt">✕</button>`;
  const label = pill.querySelector("span");
  const upd = () => { label.textContent = `Hämtar sidor och år ${done}/${list.length} (hittade ${found})`; };
  pill.querySelector("button").onclick = () => { cancelled = true; };
  upd();
  $("phone").appendChild(pill);
  for (const b of list) {
    if (cancelled) break;
    const cur = books.find((x) => x.id === b.id) || b;
    if (cur.pages && cur.year) { done++; upd(); continue; }
    try {
      const [n, y] = await Promise.all([cur.pages ? null : fetchPages(cur).catch(() => null), cur.year ? null : fetchYear(cur).catch(() => null)]);
      const f = {};
      if (n) f.pages = n;
      if (y) f.year = y;
      if (Object.keys(f).length) { updateBookDoc(b.id, f); found++; }
    } catch (e) {}
    done++; upd();
    await new Promise((res) => setTimeout(res, 250));
  }
  pill.remove();
  bgPagesRunning = false;
  toast(cancelled ? `Avbröt. Hittade uppgifter för ${found} böcker.` : `Sidantal eller år hittades för ${found} av ${list.length} böcker.`);
}

// Engångsstädning: taggar som är ursprung (t.ex. "Afrikanskt") flyttas till fältet Ursprung.
function migrateOriginTags() {
  const list = books.filter((b) => b.tags.some((t) => ORIGINS.includes(t)));
  dialog({ title: "Flytta ursprungstaggar",
    body: `${list.length} böcker har ursprung som tagg (t.ex. Afrikanskt, Ryskt). Taggarna flyttas till fältet Ursprung och tas bort som taggar.`,
    buttons: [{ label: "Avbryt" }, { label: "Flytta", action: () => {
      runBatches(list.map((b) => (batch) => batch.update(doc(booksCol, b.id), cleanFields({
        tags: b.tags.filter((t) => !ORIGINS.includes(t)),
        origin: [...new Set([...b.origin, ...b.tags.filter((t) => ORIGINS.includes(t))])],
        updatedBy: user ? user.email : ""
      }))));
      toast(`Ursprung flyttat för ${list.length} böcker`);
    } }] });
}

// ---------- Import ----------
const H = {
  author: ["författare", "forfattare", "author", "authors", "upphov", "upphovsperson"],
  title: ["titel", "title", "bok", "boktitel", "verk"],
  tags: ["taggar", "tagg", "tags", "tag", "kategori", "kategorier", "category", "categories", "genre"],
  status: ["status", "läst", "last", "lässtatus", "read"],
  isbn: ["isbn", "isbn-13", "isbn13", "isbn-10", "isbn10"],
  note: ["anteckning", "anteckningar", "notering", "kommentar", "note", "notes"],
  language: ["språk", "sprak", "language", "lang"],
  pages: ["sidor", "sidantal", "antal sidor", "pages"],
  origin: ["ursprung", "origin", "härkomst", "harkomst", "nationalitet"],
  year: ["år", "ar", "utgiven", "utgivningsår", "utgivningsar", "publiceringsår", "publikationsår", "publikationsar", "year", "published"],
  readBy: ["läst av", "last av", "read by"]
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

// "1867–69" → 1867, "375 f.Kr." → -375, "-375" → -375
function parseYear(v) {
  const t = String(v ?? "").trim();
  const m = t.match(/-?\d{1,4}/);
  if (!m) return 0;
  const y = parseInt(m[0], 10);
  return /f\.?\s?kr|\bbc\b|\bbce\b/i.test(t) ? -Math.abs(y) : y;
}
function toRows(grid) {
  if (!grid.length) return [];
  const header = grid[0];
  const find = (names) => { const i = header.findIndex((v) => names.includes(norm(v))); return i < 0 ? null : i; };
  let aCol = find(H.author), tCol = find(H.title);
  const gCol = find(H.tags), sCol = find(H.status), iCol = find(H.isbn), nCol = find(H.note);
  const lCol = find(H.language), pCol = find(H.pages), rbCol = find(H.readBy), oCol = find(H.origin), yCol = find(H.year);
  const hasHeader = [aCol, tCol, gCol, sCol, iCol, nCol, lCol, pCol, rbCol, oCol, yCol].some((x) => x !== null);
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
    const language = lCol === null ? "" : normLang(r[lCol]);
    const pages = pCol === null ? 0 : (parseInt(String(r[pCol]).replace(/\D/g, ""), 10) || 0);
    const readBy = rbCol === null ? [] : READERS.filter((n) => String(r[rbCol] || "").toLowerCase().includes(n.toLowerCase()));
    const origin = oCol === null ? [] : parseTags(r[oCol] || "");
    const year = yCol === null ? 0 : parseYear(r[yCol]);
    out.push({ author, title, tags, read: readBy.length ? true : read, isbn, note, language, pages, readBy, origin, year });
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
  const existing = rows.filter((r) => books.some((b) => b.author.trim().toLowerCase() === r.author.trim().toLowerCase() && b.title.trim().toLowerCase() === r.title.trim().toLowerCase())).length;
  let replace = false;
  const rp = document.createElement("div");
  rp.className = "switch-row";
  rp.innerHTML = `<span>Ersätt taggar, ursprung och språk på de ${existing} böcker som redan finns</span><div class="switch" role="switch" aria-checked="false"></div>`;
  rp.onclick = () => { replace = !replace; rp.lastChild.classList.toggle("on", replace); rp.lastChild.setAttribute("aria-checked", replace); };
  body.append(msg, f);
  if (existing) {
    const hint = document.createElement("div");
    hint.className = "muted small";
    hint.textContent = "Av: bara tomma fält fylls i och nya taggar läggs till. På: filens värden ersätter de gamla (läst-status, anteckningar och sidantal behålls).";
    body.append(rp, hint);
  }
  const inp = f.querySelector("input");
  suggestions(body, "Eller välj en befintlig tagg", (t) => { inp.value = t; });
  dialog({ title: "Importera böcker", body, buttons: [
    { label: "Avbryt" },
    { label: "Importera", action: () => {
      const res = importRows(rows, parseTags(inp.value), replace);
      toast(`${res.added} nya böcker, ${res.updated} uppdaterade, ${res.unchanged} fanns redan`);
      setTimeout(() => checkWishesAfterImport(rows), 400);
      if (res.needPages.length) setTimeout(() => backgroundPages(res.needPages), 1500);
    } }
  ] });
}

function importRows(rows, common, replace = false) {
  const key = (a, t) => a.trim().toLowerCase() + "\u0000" + t.trim().toLowerCase();
  const index = new Map(books.map((b) => [key(b.author, b.title), b]));
  const seenNew = new Set();
  const ops = [], needPages = [];
  let added = 0, updated = 0, unchanged = 0;
  const now = Date.now();
  for (const r of rows) {
    const tags = [...new Set([...r.tags, ...common])];
    const k = key(r.author, r.title);
    const ex = index.get(k);
    if (!ex) {
      if (seenNew.has(k)) { unchanged++; continue; }
      seenNew.add(k);
      const data = toData({ author: r.author, title: r.title, tags, read: r.read ?? false, isbn: r.isbn, added: now + added,
        language: r.language, pages: r.pages, note: r.note, readBy: r.readBy, origin: r.origin, year: r.year });
      const ref = doc(booksCol);
      ops.push((batch) => batch.set(ref, data));
      if (!data.pages || !data.year) needPages.push({ id: ref.id, isbn: data.isbn, author: data.author, title: data.title });
      added++;
    } else {
      const fields = {};
      const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
      if (replace) {
        if (tags.length && !same(tags, ex.tags)) fields.tags = tags;
        if (r.origin.length && !same(r.origin, ex.origin)) fields.origin = r.origin;
        if (r.language && r.language !== ex.language) fields.language = r.language;
      } else {
        const newTags = [...new Set([...ex.tags, ...tags])];
        if (newTags.length !== ex.tags.length) fields.tags = newTags;
        if (!ex.origin.length && r.origin.length) fields.origin = r.origin;
      }
      if (r.read === true && !ex.read) fields.read = true;
      if (!ex.isbn && r.isbn) fields.isbn = r.isbn;
      if (!ex.language && r.language) fields.language = r.language;
      if (!ex.pages && r.pages) fields.pages = r.pages;
      if (!ex.year && r.year) fields.year = r.year;
      if ((!ex.pages && !r.pages) || (!ex.year && !r.year)) needPages.push({ id: ex.id, isbn: ex.isbn || r.isbn, author: ex.author, title: ex.title, pages: ex.pages || r.pages, year: ex.year || r.year });
      if (!ex.note && r.note) fields.note = r.note;
      const rb = [...new Set([...(ex.readBy || []), ...(r.readBy || [])])];
      if (rb.length !== (ex.readBy || []).length) { fields.readBy = rb; if (!ex.read) fields.read = true; }
      if (Object.keys(fields).length) {
        fields.updatedBy = user ? user.email : "";
        const clean = cleanFields(fields);
        ops.push((batch) => batch.update(doc(booksCol, ex.id), clean));
        updated++;
      } else unchanged++;
    }
  }
  runBatches(ops);
  return { added, updated, unchanged, needPages };
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
  const aoa = [["Författare", "Titel", "Taggar", "Ursprung", "Språk", "År", "Status", "Läst av", "Sidor", "ISBN", "Anteckning"]].concat(
    list.map((b) => [b.author, b.title, b.tags.join(", "), b.origin.join(", "), b.language || "", b.year || "", b.read ? "Läst" : "Oläst",
      (b.readBy || []).join(", "), b.pages || "", b.isbn || "", b.note || ""]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 30 }, { wch: 45 }, { wch: 25 }, { wch: 22 }, { wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 16 }, { wch: 7 }, { wch: 16 }, { wch: 40 }];
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
  const x = normName(naturalName(a)), y = normName(naturalName(b));
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" "), ys = y.split(" ");
  // "Leo Tolstoj" = "Lev Tolstoj": samma efternamn och samma initial.
  return xs[xs.length - 1] === ys[ys.length - 1] && xs[0][0] === ys[0][0];
}
// Böcker med "Antologi" (eller liknande) som författare räknas inte som att man
// "har" en viss författare – deras bidragsgivare ska fortfarande kunna föreslås.
const ANTHOLOGY = ["antologi", "antologier", "anthology", "diverse", "diverse forfattare", "olika forfattare", "various", "various authors",
  "okand", "okand forfattare", "anonym", "anonymous", "unknown"];
const isAnthology = (b) => ANTHOLOGY.includes(normName(b.author)) || b.tags.some((t) => ["antologi", "anthology"].includes(normName(t)));
// "Charlotte, Emily & Anne Brontë" → ["Charlotte Brontë", "Emily Brontë", "Anne Brontë"]
function authorNames(a) {
  const n = naturalName(a);
  if (!/&|\soch\s|\sand\s/i.test(n)) return [n];
  const parts = n.split(/\s*(?:,|&|\soch\s|\sand\s)\s*/i).filter(Boolean);
  const last = parts[parts.length - 1].split(" ");
  const surname = last.length > 1 ? last[last.length - 1] : "";
  return parts.map((p) => (p.includes(" ") || !surname ? p : `${p} ${surname}`)).concat([n]);
}
const anyAuthor = (a, names) => authorNames(a).some((x) => names.some((y) => sameAuthor(x, y)));
const ownsTitle = (author, title) => ownsWork(author, [title]);
// Ett verk räknas som ägt om någon av dess titelformer (inkl. översättningar) finns hos samma författare.
const ownsWork = (author, titles) => books.some((b) => titles.some((t) => sameTitle(b.title, t)) &&
  (!author || !b.author || anyAuthor(b.author, [author])));
const ownsAuthor = (author, names = []) => books.some((b) => !isAnthology(b) && anyAuthor(b.author, [author, ...names]));
const wishFor = (author, title) => wishes.find((w) => w.title && sameTitle(w.title, title) && (!author || sameAuthor(w.author, author)));
const authorWish = (author) => wishes.find((w) => !w.title && sameAuthor(w.author, author));

function addWish({ author, title = "", note = "", kind = wishKind, isbn = "" }) {
  if (title ? wishFor(author, title) : authorWish(author)) { toast("Finns redan på önskelistan"); return false; }
  setDoc(doc(wishCol), cleanWish({ author, title, note, kind, isbn, added: Date.now(), updatedBy: user ? user.email : "" })).catch(writeFailed);
  return true;
}
const cleanWish = (w) => ({ ...w, author: clip(w.author, 300), title: clip(w.title, 500), note: clip(w.note, 1000),
  ...("kind" in w ? { kind: WISH_KINDS.includes(w.kind) ? w.kind : "Skönlitteratur" } : {}), ...("isbn" in w ? { isbn: clip(w.isbn, 20) } : {}) });
function deleteWish(id) { deleteDoc(doc(wishCol, id)).catch(writeFailed); }

$("wishBtn").onclick = () => {
  mode = mode === "wish" ? "library" : "wish";
  if (mode === "wish") wishKind = "Skönlitteratur";
  $("list").scrollTop = 0;
  refreshAll();
};

function addTipsButton(header, author) {
  if (!author || ANTHOLOGY.includes(normName(author))) return;
  const b = document.createElement("button");
  b.className = "icon-btn tips-btn";
  b.setAttribute("aria-label", `Tips om ${author}`);
  b.title = "Tips: centrala verk och liknande författare";
  b.innerHTML = ICON_TIPS;
  b.onclick = (e) => { e.stopPropagation(); showTips(author); };
  header.appendChild(b);
}

// Välj del av önskelistan: Skönlitteratur eller Sakprosa (en åt gången).
function renderWishChips() {
  const el = $("chips");
  el.style.display = "flex";
  el.innerHTML = "";
  for (const k of WISH_KINDS) {
    const c = document.createElement("button");
    c.className = "chip" + (wishKind === k ? " on" : "");
    c.innerHTML = `${esc(k)}<small>${wishes.filter((w) => w.kind === k).length}</small>`;
    c.onclick = () => { wishKind = k; $("list").scrollTop = 0; renderWishChips(); renderList(); };
    el.appendChild(c);
  }
}
const collapsedWish = new Set();
function renderWishList() {
  const q = query.toLowerCase();
  const inKind = wishes.filter((w) => w.kind === wishKind);
  const filtered = inKind.filter((w) => !q || w.author.toLowerCase().includes(q) || displayAuthor(w.author).toLowerCase().includes(q) || w.title.toLowerCase().includes(q) || w.note.toLowerCase().includes(q));
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
    h.innerHTML = `${ICON_CHEV}<div class="n">${esc(displayAuthor(gw[0].author) || "Okänd författare")}</div><div class="c">${info}</div>`;
    addTipsButton(h, gw[0].author.trim());
    h.onclick = () => { if (query) return; collapsedWish.has(k) ? collapsedWish.delete(k) : collapsedWish.add(k); renderList(); };
    list.appendChild(h);
    if (!open) continue;
    for (const w of gw) list.appendChild(wishRow(w));
  }
  if (!inKind.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = (wishes.length ? `Inget under ${wishKind} ännu.` : "Önskelistan är tom.") + "\n\nLägg till en titel eller en författare du är nyfiken på med +, importera en Excelfil via menyn (⋮), eller tryck på glödlampan vid en författare för att få tips.";
    list.appendChild(e);
  }
  list.scrollTop = scroll;
  $("count").innerHTML = `${filtered.length} på önskelistan (${wishKind.toLowerCase()})` + (syncState ? ` <span class="sync">· ${esc(syncState)}</span>` : "");
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
  editBook(null, { author: w.author, title: w.title, tags: [w.kind] }, w.isbn || "", false, w.id);
}

function editWish(w, prefill = null) {
  const body = document.createElement("div");
  const fA = field("Författare", w ? w.author : (prefill?.author || ""));
  const fT = field("Titel (lämna tomt för hela författarskapet)", w ? w.title : (prefill?.title || ""));
  const fN = field("Anteckning (valfritt)", w ? w.note : (prefill?.note || ""), 'maxlength="1000"');
  let kind = w ? w.kind : (prefill?.kind || wishKind);
  const kRow = document.createElement("div");
  kRow.className = "field";
  kRow.innerHTML = `<label>Del av önskelistan</label><div class="sugg"></div>`;
  const drawKind = () => {
    const g = kRow.querySelector(".sugg"); g.innerHTML = "";
    for (const k of WISH_KINDS) {
      const c = document.createElement("button");
      c.className = "chip" + (kind === k ? " on" : "");
      c.textContent = k;
      c.onclick = () => { kind = k; drawKind(); };
      g.appendChild(c);
    }
  };
  drawKind();
  body.append(fA, fT, fN, kRow);
  const inA = fA.querySelector("input"), inT = fT.querySelector("input"), inN = fN.querySelector("input");
  const isbn = w ? w.isbn : (prefill?.isbn || "");
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
          updateDoc(doc(wishCol, w.id), cleanWish({ author, title, note, kind, updatedBy: user ? user.email : "" })).catch(writeFailed);
          if (kind !== wishKind) toast(`Flyttad till ${kind}`);
          return;
        }
        if (title && ownsTitle(author, title)) {
          setTimeout(() => dialog({
            title: "Finns redan i biblioteket",
            body: `Du har redan ”${title}” i biblioteket. Vill du ändå lägga den på önskelistan, t.ex. för en annan utgåva?`,
            buttons: [{ label: "Avbryt" }, { label: "Lägg till ändå", action: () => { if (addWish({ author, title, note, kind, isbn })) toast(`Tillagd på önskelistan (${kind})`); } }]
          }), 50);
          return;
        }
        if (addWish({ author, title, note, kind, isbn })) toast(`Tillagd på önskelistan (${kind})`);
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
  const seen = new Set(), add = [], fix = [];
  for (const r of rows) {
    const key = normName(r.author) + "|" + (r.title ? normName(r.title) : "");
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);
    if (r.title && ownsTitle(r.author, r.title)) { owned++; continue; }
    const ex = r.title ? wishFor(r.author, r.title) : authorWish(r.author);
    if (ex) {
      dup++;
      // Befintlig önskning: rätta del (Skönlitteratur/Sakprosa) och fyll i ISBN från filen.
      const f = {};
      if (r.tags.length && kindFromTags(r.tags) !== ex.kind) f.kind = kindFromTags(r.tags);
      if (r.isbn && !ex.isbn) f.isbn = r.isbn;
      if (Object.keys(f).length) fix.push([ex, f]);
      continue;
    }
    add.push(r);
  }
  const fk = { Skönlitteratur: 0, Sakprosa: 0 };
  add.forEach((r) => fk[kindFromTags(r.tags)]++);
  const msg = `Hittade ${rows.length} rader i filen.\n\n• ${add.length} läggs till på önskelistan (${fk.Skönlitteratur} skönlitteratur, ${fk.Sakprosa} sakprosa)` +
    (dup ? `\n• ${dup} finns redan på önskelistan` + (fix.length ? ` (${fix.length} av dem får del eller ISBN från filen)` : "") : "") +
    (owned ? `\n• ${owned} har du redan i biblioteket och hoppas över` : "") +
    `\n\nRader med bara ett författarnamn blir ”intresserad av författarskapet”.`;
  dialog({ title: "Importera önskelista", body: msg, buttons: [
    { label: "Avbryt" },
    { label: "Importera", action: () => {
      if (!add.length && !fix.length) return;
      const now = Date.now();
      runBatches([
        ...add.map((r, i) => (batch) => batch.set(doc(wishCol), cleanWish({
          author: r.author, title: r.title, note: r.note || "", kind: kindFromTags(r.tags), isbn: r.isbn || "", added: now + i, updatedBy: user ? user.email : ""
        }))),
        ...fix.map(([ex, f]) => (batch) => batch.update(doc(wishCol, ex.id), cleanWish({ author: ex.author, title: ex.title, note: ex.note, ...f, updatedBy: user ? user.email : "" })))
      ]);
      toast(`${add.length} tillagda på önskelistan` + (fix.length ? `, ${fix.length} uppdaterade` : ""));
    } }
  ] });
}

function exportWishes() {
  if (!wishes.length) { toast("Önskelistan är tom"); return; }
  if (typeof XLSX === "undefined") { toast("Exporten misslyckades"); return; }
  const list = wishes.slice().sort((a, b) => collator.compare(authorSortKey(a), authorSortKey(b)) || collator.compare(a.title, b.title));
  const ws = XLSX.utils.aoa_to_sheet([["Författare", "Titel", "Anteckning", "ISBN", "Taggar"]].concat(list.map((w) => [w.author, w.title, w.note, w.isbn || "", w.kind])));
  ws["!cols"] = [{ wch: 32 }, { wch: 50 }, { wch: 40 }, { wch: 16 }, { wch: 16 }];
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
  author = authorNames(naturalName(author))[0];
  // Typ av författare enligt dina egna taggar på hens böcker: skönlitteratur, sakprosa eller blandat.
  // Saknas hen i biblioteket används önskelistans del (om hen finns där).
  const mine = books.filter((b) => !isAnthology(b) && anyAuthor(b.author, [author]));
  let fic = mine.filter((b) => b.tags.some((t) => ["Skönlitteratur", "Fiktion", "Poesi", "Serier"].includes(t))).length;
  let non = mine.filter((b) => b.tags.includes("Sakprosa")).length;
  if (!mine.length) { const ws = wishes.filter((w) => sameAuthor(w.author, author)); fic = ws.filter((w) => w.kind === "Skönlitteratur").length; non = ws.length - fic; }
  const kind = fic && !non ? "fiction" : non && !fic ? "nonfiction" : fic > 2 * non ? "fiction" : non > 2 * fic ? "nonfiction" : "any";
  const tipKind = () => kind === "nonfiction" ? "Sakprosa" : kind === "fiction" ? "Skönlitteratur" : (mode === "wish" ? wishKind : "Skönlitteratur");
  const body = document.createElement("div");
  body.className = "tips";
  body.innerHTML = `<h3>Centrala verk du inte har</h3><div class="tips-works"><div class="progress small"><div class="spinner"></div><div>Hämtar verk …</div></div></div>` +
    `<h3>Liknande och kompletterande författare</h3><div class="tips-similar"><div class="progress small"><div class="spinner"></div><div>Letar efter liknande författare … (kan ta upp till en halv minut första gången)</div></div></div>` +
    `<p class="tips-source">Källor: Wikidata och Open Library (öppna databaser). Sparas i 30 dagar på enheten.</p>`;
  const d = dialog({
    title: displayAuthor(author),
    body,
    neutral: { label: "Uppdatera", action: () => { setTimeout(() => showTips(author, true), 50); } },
    buttons: [{ label: "Stäng" }]
  });
  const worksBox = body.querySelector(".tips-works"), simBox = body.querySelector(".tips-similar");

  getWorks(author, { refresh }).then((data) => {
    const fresh = [], owned = [];
    for (const w of data.works) (ownsWork(author, w.titles && w.titles.length ? w.titles : [w.title]) ? owned : fresh).push(w);
    worksBox.innerHTML = "";
    if (!data.works.length) { worksBox.innerHTML = `<p class="muted">Hittade inga verk för ${esc(author)} i de öppna databaserna.</p>`; return; }
    if (!fresh.length) worksBox.innerHTML = `<p class="muted">Du har redan alla de mest kända verken.</p>`;
    const show = (items) => items.forEach((w) => worksBox.appendChild(tipItem({
      title: w.title + (w.year ? ` (${w.year})` : ""),
      sub: w.notable ? "Räknas som ett av författarens viktigaste verk" : "",
      onWish: wishFor(author, w.title) ? null : () => addWish({ author, title: w.title, note: "Tips: centralt verk", kind: tipKind() }),
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

  getSimilar(author, { refresh, kind }).then((data) => {
    simBox.innerHTML = "";
    if (!data.similar.length) {
      simBox.innerHTML = data.found
        ? `<p class="muted">Hittade inga liknande författare i de öppna databaserna.</p>`
        : `<p class="muted">Hittade inte författaren i Wikidata – den kan saknas där, eller så svarar Wikidata inte just nu. Försök igen senare.</p>`;
      return;
    }
    const fresh = data.similar.filter((s) => !ownsAuthor(s.name, s.names || []) && !sameAuthor(s.name, author));
    const ownedCount = data.similar.length - fresh.length;
    if (!fresh.length) simBox.innerHTML = `<p class="muted">Alla föreslagna författare finns redan i ditt bibliotek.</p>`;
    if (ownedCount) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `${ownedCount} författare som du redan har visas inte.`;
      setTimeout(() => simBox.appendChild(p), 0);
    }
    fresh.slice(0, 5).forEach((s) => {
      const own = false;
      simBox.appendChild(tipItem({
        title: displayAuthor(s.name),
        sub: s.reasons.join(" · "),
        badge: own ? "Finns i ditt bibliotek" : "",
        onWish: own || authorWish(s.name) ? null : () => addWish({ author: s.name, note: `Tips via ${author}`, kind: tipKind() }),
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

$("filterBtn").onclick = openFilters;
// Olästa/Lästa: välj vems läsning som gäller (vem som helst, David eller Felicia).
function setStatus(s, reader) {
  statusFilter = s; statusReader = s === "all" ? null : reader;
  $("statusGroup").querySelectorAll("button").forEach((x) => {
    x.classList.toggle("on", x.dataset.s === s);
    const base = x.dataset.s === "read" ? "Lästa" : x.dataset.s === "unread" ? "Olästa" : "Alla";
    x.textContent = base + (x.dataset.s === s && statusReader ? " · " + statusReader : "");
  });
  renderList();
}
$("statusGroup").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    const s = b.dataset.s;
    if (s === "all") { setStatus("all", null); return; }
    const verb = s === "read" ? "Lästa av" : "Olästa av";
    choiceDialog(s === "read" ? "Visa lästa" : "Visa olästa",
      [["", s === "read" ? "Lästa av någon" : "Olästa av alla"], ...READERS.map((n) => [n, `${verb} ${n}`])],
      statusFilter === s ? (statusReader || "") : null,
      (k) => setStatus(s, k || null));
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
