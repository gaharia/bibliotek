// Författartips från öppna källor, utan konton eller nycklar:
// - Wikidata (wikidata.org): centrala verk, inspiratörer, efterföljare, litterär rörelse
// - Wikidatas frågetjänst: reserv för liknande författare (samma land, yrke och epok)
// - Open Library (openlibrary.org): reserv för verk när Wikidata saknar data

const API = "https://www.wikidata.org/w/api.php?format=json&origin=*&";
const WDQS = "https://query.wikidata.org/sparql?format=json&query=";
const CACHE_KEY = "bibliotek-tips-v3";
const CACHE_DAYS = 30;
// Yrken som räknas som skönlitterära författare.
const WRITERS = ["Q36180", "Q6625963", "Q49757", "Q214917", "Q482980", "Q4853732", "Q11774202", "Q15949613", "Q12144794", "Q18844224"];

async function getJson(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("Svar " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const wd = (params) => getJson(API + new URLSearchParams(params));

async function entities(ids, props = "labels|sitelinks|claims") {
  const out = {};
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 50) {
    const j = await wd({ action: "wbgetentities", ids: uniq.slice(i, i + 50).join("|"), props, languages: "sv|en|mul" });
    Object.assign(out, j.entities || {});
  }
  return out;
}
async function search(query, limit = 50) {
  const j = await wd({ action: "query", list: "search", srsearch: query, srlimit: limit, srnamespace: 0 });
  return ((j.query && j.query.search) || []).map((x) => x.title);
}

const claimIds = (e, p) => ((e && e.claims && e.claims[p]) || [])
  .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
  .filter(Boolean);
const year = (e, p) => {
  const c = e && e.claims && e.claims[p] && e.claims[p][0];
  const t = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value.time;
  return t ? parseInt(t.slice(0, 5), 10) : null;
};
const label = (e) => {
  const l = (e && e.labels) || {};
  return (l.sv || l.en || l.mul || Object.values(l)[0] || {}).value || "";
};
const popularity = (e) => Object.keys((e && e.sitelinks) || {}).length;
const isWriter = (e) => claimIds(e, "P106").some((o) => WRITERS.includes(o));

// ---------- Jämförelse med det man redan har ----------
export function normTitle(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^(the|a|an|en|ett|den|det|der|die|das|le|la|les|el)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
export function sameTitle(a, b) {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 5 && (l.startsWith(s + " ") || l.includes(" " + s + " ") || l.endsWith(" " + s));
}
export function normName(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();
}

// ---------- Cache (30 dagar, per enhet) ----------
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; } }
function cached(kind, name) {
  const hit = readCache()[kind + ":" + normName(name)];
  return hit && Date.now() - hit.t < CACHE_DAYS * 864e5 ? hit.data : null;
}
function store(kind, name, data) {
  try {
    const c = readCache();
    c[kind + ":" + normName(name)] = { t: Date.now(), data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch (e) {}
}

// ---------- Författaren ----------
const authorMemo = new Map();
function findAuthor(name) {
  const key = normName(name);
  if (!authorMemo.has(key)) {
    authorMemo.set(key, (async () => {
      const j = await wd({ action: "wbsearchentities", search: name, language: "sv", uselang: "sv", type: "item", limit: 7 });
      const ids = (j.search || []).map((s) => s.id);
      if (!ids.length) return null;
      const ents = await entities(ids, "claims|sitelinks|labels");
      for (const id of ids) if (claimIds(ents[id], "P31").includes("Q5")) return ents[id];
      return null;
    })().catch((e) => { authorMemo.delete(key); throw e; }));
  }
  return authorMemo.get(key);
}

// ---------- Centrala verk ----------
async function openLibraryWorks(name) {
  const a = await getJson("https://openlibrary.org/search/authors.json?limit=1&q=" + encodeURIComponent(name));
  if (!a.docs || !a.docs.length) return [];
  const w = await getJson(`https://openlibrary.org/search.json?author_key=${a.docs[0].key}&sort=editions&limit=25&fields=title,first_publish_year,edition_count`);
  return (w.docs || []).map((d) => ({ title: d.title, year: d.first_publish_year || "", notable: false, pop: d.edition_count || 0, source: "Open Library" }));
}

export async function getWorks(name, { refresh = false } = {}) {
  if (!refresh) { const c = cached("works", name); if (c) return c; }
  const author = await findAuthor(name);
  let list = [];
  if (author) {
    const notable = claimIds(author, "P800");
    const written = await search(`haswbstatement:P50=${author.id}`, 40).catch(() => []);
    const ents = await entities([...notable, ...written]);
    for (const id of new Set([...notable, ...written])) {
      const e = ents[id];
      if (!e || claimIds(e, "P31").includes("Q13442814")) continue; // inte vetenskapliga artiklar
      const isNotable = notable.includes(id), pop = popularity(e), title = label(e);
      if (!title || (!isNotable && pop === 0)) continue;
      list.push({ title, year: year(e, "P577") || "", notable: isNotable, pop, source: "Wikidata" });
    }
  }
  if (list.length < 3) list = list.concat(await openLibraryWorks(name).catch(() => []));
  // Samma verk kan finnas flera gånger (t.ex. utgåvor): behåll det mest kända.
  const seen = new Map();
  for (const w of list.sort((a, b) => (b.notable - a.notable) || (b.pop - a.pop))) {
    const k = normTitle(w.title);
    if (k && !seen.has(k)) seen.set(k, w);
  }
  const data = { found: !!author, name: author ? label(author) : name, works: [...seen.values()].slice(0, 30) };
  store("works", name, data);
  return data;
}

// ---------- Liknande och kompletterande författare ----------
async function eraPeers(author) {
  // Romanförfattare, poeter och dramatiker från samma land, födda inom ±15 år.
  const q = `SELECT ?b ?sl WHERE {
    { SELECT ?b (MAX(?s) AS ?sl) WHERE {
      wd:${author.id} wdt:P27 ?c; wdt:P569 ?bd.
      VALUES ?occ { wd:Q6625963 wd:Q49757 wd:Q214917 }
      ?b wdt:P106 ?occ; wdt:P27 ?c; wdt:P569 ?bd2; wikibase:sitelinks ?s.
      FILTER(?b != wd:${author.id}) FILTER(ABS(YEAR(?bd2) - YEAR(?bd)) <= 15) FILTER(?s >= 5)
    } GROUP BY ?b ORDER BY DESC(?sl) LIMIT 15 } }`;
  const j = await getJson(WDQS + encodeURIComponent(q), 30000);
  return j.results.bindings.map((b) => b.b.value.split("/").pop());
}

export async function getSimilar(name, { refresh = false } = {}) {
  if (!refresh) { const c = cached("similar", name); if (c) return c; }
  const author = await findAuthor(name);
  if (!author) { const d = { found: false, similar: [] }; store("similar", name, d); return d; }
  const reasons = new Map();
  const add = (id, why) => {
    if (id === author.id) return;
    if (!reasons.has(id)) reasons.set(id, new Set());
    reasons.get(id).add(why);
  };
  claimIds(author, "P737").forEach((id) => add(id, "Inspirerade författaren"));
  (await search(`haswbstatement:P737=${author.id}`, 50).catch(() => [])).forEach((id) => add(id, "Påverkad av författaren"));
  const movements = claimIds(author, "P135").slice(0, 2);
  const movementNames = movements.length ? await entities(movements, "labels") : {};
  for (const m of movements) {
    const n = label(movementNames[m]);
    (await search(`haswbstatement:P135=${m} haswbstatement:P31=Q5`, 50).catch(() => []))
      .forEach((id) => add(id, n ? `Samma litterära rörelse: ${n}` : "Samma litterära rörelse"));
  }

  const ents = await entities([...reasons.keys()], "labels|sitelinks|claims");
  let out = [];
  for (const [id, set] of reasons) {
    const e = ents[id];
    if (!e || !claimIds(e, "P31").includes("Q5") || !isWriter(e)) continue;
    const why = [...set];
    const direct = why.some((w) => w.startsWith("Inspirerade") || w.startsWith("Påverkad"));
    out.push({ name: label(e), reasons: why, score: popularity(e) + (direct ? 150 : 0) + (why.length - 1) * 50 });
  }

  if (out.length < 6) {
    try {
      const peers = await eraPeers(author);
      const pe = await entities(peers.filter((id) => !reasons.has(id)), "labels|sitelinks|claims");
      const country = label((await entities(claimIds(author, "P27").slice(0, 1), "labels"))[claimIds(author, "P27")[0]]);
      for (const id of peers) {
        const e = pe[id];
        if (!e) continue;
        out.push({ name: label(e), reasons: [country ? `Samma epok och land (${country})` : "Samma epok och land"], score: popularity(e) });
      }
    } catch (e) { /* frågetjänsten svarade inte – visa det som finns */ }
  }
  out = out.filter((s) => s.name).sort((a, b) => b.score - a.score).slice(0, 20);
  const data = { found: true, similar: out };
  store("similar", name, data);
  return data;
}
