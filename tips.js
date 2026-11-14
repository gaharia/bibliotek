// Författartips från öppna källor, utan konton eller nycklar:
// - Wikidata (wikidata.org): centrala verk, inspiratörer, efterföljare, litterär rörelse
// - Wikidatas frågetjänst: reserv för liknande författare (samma land, yrke och epok)
// - Open Library (openlibrary.org): reserv för verk när Wikidata saknar data

const API = "https://www.wikidata.org/w/api.php?format=json&origin=*&";
const WDQS = "https://query.wikidata.org/sparql?format=json&query=";
const CACHE_KEY = "bibliotek-tips-v5";
// Språk vars titlar och namnformer jämförs med det man redan har (översättningar).
const VARIANT_LANGS = "sv|en|mul|de|fr|ru|es|it|da|nb|nn|fi|pl|pt|nl|cs|la|el|ja|ko|zh";
const CACHE_DAYS = 30;
// Skönlitterära yrken: romanförfattare, poet, dramatiker, novellförfattare, prosaist,
// sf-författare, barnboksförfattare, librettist.
const LIT_OCC = ["Q6625963", "Q49757", "Q214917", "Q15949613", "Q12144794", "Q18844224", "Q4853732", "Q8178443"];
// Allmänna skribentyrken (författare, essäist). Räcker bara om personen har ett skönlitterärt huvudverk.
const GEN_OCC = ["Q36180", "Q482980", "Q11774202"];
// Yrken som tyder på att personen främst är något annat (filosof, skådespelare, regissör,
// forskare, musiker). Då krävs ett skönlitterärt huvudverk även om ett författaryrke finns.
const OTHER_OCC = ["Q4964182", "Q33999", "Q10800557", "Q2259451", "Q2526255", "Q3455803", "Q28389", "Q901", "Q169470", "Q170790", "Q36834", "Q177220", "Q639669", "Q82955"];
// Typer av verk som räknas som skönlitteratur.
// ("litterärt verk" Q7725634 är för brett – Wikidata använder det även för filosofi och essäer.)
// Genrer (P136): poesi, drama.
const LIT_WORK = ["Q482", "Q25372", "Q8261", "Q49084", "Q5185279", "Q25379", "Q1279564", "Q12106333", "Q149537", "Q37484", "Q699", "Q24723", "Q116476516"];

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

async function entities(ids, props = "labels|sitelinks|claims", languages = "sv|en|mul") {
  const out = {};
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 50) {
    const j = await wd({ action: "wbgetentities", ids: uniq.slice(i, i + 50).join("|"), props, languages });
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
// Alla namn-/titelformer: etiketter och alias på flera språk, plus originaltitel (P1476).
const variants = (e) => {
  const out = new Set();
  for (const l of Object.values((e && e.labels) || {})) out.add(l.value);
  for (const list of Object.values((e && e.aliases) || {})) for (const a of list) out.add(a.value);
  for (const c of (e && e.claims && e.claims.P1476) || []) { const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value; if (v && v.text) out.add(v.text); }
  return [...out].filter(Boolean);
};
const popularity = (e) => Object.keys((e && e.sitelinks) || {}).length;
const hasLitOcc = (e) => claimIds(e, "P106").some((o) => LIT_OCC.includes(o));
const hasGenOcc = (e) => claimIds(e, "P106").some((o) => GEN_OCC.includes(o));
// Behåll bara skönlitterära författare. Den som bara står som "författare"/"essäist"
// (t.ex. filosofer och forskare) måste ha ett skönlitterärt verk bland sina huvudverk.
async function fictionWriters(ents) {
  const other = (e) => claimIds(e, "P106").some((o) => OTHER_OCC.includes(o));
  const unsure = Object.values(ents).filter((e) => e && (hasGenOcc(e) || hasLitOcc(e)) && (!hasLitOcc(e) || other(e)));
  const workIds = unsure.flatMap((e) => claimIds(e, "P800").slice(0, 5));
  const works = workIds.length ? await entities(workIds, "claims").catch(() => ({})) : {};
  const kinds = (w) => [...claimIds(works[w], "P31"), ...claimIds(works[w], "P136")];
  const ok = new Set();
  for (const e of Object.values(ents)) {
    if (!e || !claimIds(e, "P31").includes("Q5")) continue;
    const top = claimIds(e, "P800").slice(0, 5);
    if (hasLitOcc(e) && !other(e)) ok.add(e.id);
    // Skönlitterärt yrke + annat yrke (t.ex. Tolstoj som också är filosof): räcker med "litterärt verk".
    else if (hasLitOcc(e) && top.some((w) => kinds(w).some((t) => t === "Q7725634" || LIT_WORK.includes(t)))) ok.add(e.id);
    // Bara "författare"/"essäist" (t.ex. Kant): kräver roman, dikt, pjäs, novell eller liknande.
    else if (hasGenOcc(e) && top.some((w) => kinds(w).some((t) => LIT_WORK.includes(t)))) ok.add(e.id);
  }
  return ok;
}

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
    const ents = await entities([...notable, ...written], "labels|aliases|sitelinks|claims", VARIANT_LANGS);
    for (const id of new Set([...notable, ...written])) {
      const e = ents[id];
      if (!e || claimIds(e, "P31").includes("Q13442814")) continue; // inte vetenskapliga artiklar
      const isNotable = notable.includes(id), pop = popularity(e), title = label(e);
      if (!title || (!isNotable && pop === 0)) continue;
      list.push({ title, titles: variants(e), year: year(e, "P577") || "", notable: isNotable, pop, source: "Wikidata" });
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

  const ents = await entities([...reasons.keys()], "labels|aliases|sitelinks|claims", VARIANT_LANGS);
  const fiction = await fictionWriters(ents);
  let out = [];
  for (const [id, set] of reasons) {
    const e = ents[id];
    if (!e || !fiction.has(id)) continue;
    const why = [...set];
    const direct = why.some((w) => w.startsWith("Inspirerade") || w.startsWith("Påverkad"));
    out.push({ name: label(e), names: variants(e), reasons: why, score: popularity(e) + (direct ? 150 : 0) + (why.length - 1) * 50 });
  }

  if (out.length < 6) {
    try {
      const peers = await eraPeers(author);
      const pe = await entities(peers.filter((id) => !reasons.has(id)), "labels|aliases|sitelinks|claims", VARIANT_LANGS);
      const peFiction = await fictionWriters(pe);
      const country = label((await entities(claimIds(author, "P27").slice(0, 1), "labels"))[claimIds(author, "P27")[0]]);
      for (const id of peers) {
        const e = pe[id];
        if (!e || !peFiction.has(id)) continue;
        out.push({ name: label(e), names: variants(e), reasons: [country ? `Samma epok och land (${country})` : "Samma epok och land"], score: popularity(e) });
      }
    } catch (e) { /* frågetjänsten svarade inte – visa det som finns */ }
  }
  out = out.filter((s) => s.name).sort((a, b) => b.score - a.score).slice(0, 40);
  const data = { found: true, similar: out };
  store("similar", name, data);
  return data;
}

// ---------- Ursprung (för skanning) ----------
// Författarens medborgarskap (P27) översatt till bibliotekets ursprungskategorier.
const ORIGIN_BY_COUNTRY = {
  Q34: ["Svenskt", "Nordiskt"], Q20: ["Nordiskt"], Q35: ["Nordiskt"], Q33: ["Nordiskt"], Q189: ["Nordiskt"],
  Q145: ["Brittiskt"], Q21: ["Brittiskt"], Q22: ["Brittiskt"], Q25: ["Brittiskt"], Q174193: ["Brittiskt"], Q161885: ["Brittiskt"],
  Q30: ["Amerikanskt"],
  Q27: ["Övrigt engelskspråkigt"], Q16: ["Övrigt engelskspråkigt"], Q408: ["Övrigt engelskspråkigt"], Q664: ["Övrigt engelskspråkigt"],
  Q159: ["Ryskt"], Q34266: ["Ryskt"], Q15180: ["Ryskt"], Q2184: ["Ryskt"],
  Q142: ["Franskt"], Q70972: ["Franskt"], Q71084: ["Franskt"],
  Q183: ["Tyskspråkigt"], Q40: ["Tyskspråkigt"], Q39: ["Tyskspråkigt"], Q43287: ["Tyskspråkigt"], Q713750: ["Tyskspråkigt"],
  Q16957: ["Tyskspråkigt"], Q41304: ["Tyskspråkigt"], Q7318: ["Tyskspråkigt"], Q27306: ["Tyskspråkigt"], Q28513: ["Tyskspråkigt"],
  Q38: ["Italienskt"], Q172579: ["Italienskt"],
  Q36: ["Östeuropeiskt"], Q213: ["Östeuropeiskt"], Q33946: ["Östeuropeiskt"], Q28: ["Östeuropeiskt"], Q218: ["Östeuropeiskt"],
  Q219: ["Östeuropeiskt"], Q212: ["Östeuropeiskt"], Q184: ["Östeuropeiskt"], Q403: ["Östeuropeiskt"], Q36704: ["Östeuropeiskt"],
  Q214: ["Östeuropeiskt"], Q224: ["Östeuropeiskt"], Q215: ["Östeuropeiskt"], Q37: ["Östeuropeiskt"], Q211: ["Östeuropeiskt"],
  Q191: ["Östeuropeiskt"], Q230: ["Östeuropeiskt"], Q399: ["Östeuropeiskt"], Q217: ["Östeuropeiskt"], Q221: ["Östeuropeiskt"],
  Q225: ["Östeuropeiskt"], Q236: ["Östeuropeiskt"], Q222: ["Östeuropeiskt"],
  Q822: ["Mellanöstern"], Q794: ["Mellanöstern"], Q796: ["Mellanöstern"], Q858: ["Mellanöstern"], Q801: ["Mellanöstern"],
  Q43: ["Mellanöstern"], Q12560: ["Mellanöstern"], Q851: ["Mellanöstern"], Q810: ["Mellanöstern"], Q219060: ["Mellanöstern"],
  Q889: ["Mellanöstern"], Q817: ["Mellanöstern"], Q842: ["Mellanöstern"], Q805: ["Mellanöstern"], Q398: ["Mellanöstern"]
};
// Reserv via världsdel (P30): Afrika, Asien, Sydamerika, Nordamerika (utom USA/Kanada ovan).
const ORIGIN_BY_CONTINENT = { Q15: ["Afrikanskt"], Q48: ["Asiatiskt"], Q18: ["Latinamerikanskt"], Q49: ["Latinamerikanskt"], Q55643: ["Övrigt engelskspråkigt"] };

export async function getOrigin(name) {
  if (!name) return [];
  const author = await findAuthor(name);
  if (!author) return [];
  const born = year(author, "P569");
  if (born !== null && born < 500) return ["Antiken"];
  const countries = claimIds(author, "P27");
  const out = new Set();
  const unknown = [];
  for (const c of countries) (ORIGIN_BY_COUNTRY[c] || (unknown.push(c), [])).forEach((o) => out.add(o));
  if (!out.size && unknown.length) {
    const ents = await entities(unknown.slice(0, 5), "claims").catch(() => ({}));
    for (const c of unknown) for (const k of claimIds(ents[c], "P30")) (ORIGIN_BY_CONTINENT[k] || []).forEach((o) => out.add(o));
  }
  return [...out];
}
