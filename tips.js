// Författartips från öppna källor, utan konton eller nycklar:
// - Wikidata (wikidata.org): centrala verk, inspiratörer, efterföljare, litterär rörelse
// - Wikidatas frågetjänst: reserv för liknande författare (samma land, yrke och epok)
// - Open Library (openlibrary.org): reserv för verk när Wikidata saknar data

const API = "https://www.wikidata.org/w/api.php?format=json&origin=*&";
const WDQS = "https://query.wikidata.org/sparql?format=json&query=";
const CACHE_KEY = "bibliotek-tips-v7";
// Språk vars titlar och namnformer jämförs med det man redan har (översättningar).
const VARIANT_LANGS = "sv|en|mul|de|fr|ru|es|it|da|nb|nn|fi|pl|pt|nl|cs|la|el|ja|ko|zh";
const CACHE_DAYS = 30;
// Skönlitterära yrken: romanförfattare, poet, dramatiker, novellförfattare, prosaist,
// sf-författare, barnboksförfattare, librettist.
const LIT_OCC = ["Q6625963", "Q49757", "Q214917", "Q15949613", "Q12144794", "Q18844224", "Q4853732", "Q8178443"];
// Allmänna skribentyrken (författare, essäist) – används när typen av författarskap är oklar.
const GEN_OCC = ["Q36180", "Q482980", "Q11774202"];

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
// Som search(), men returnerar även totalt antal träffar (för att avgöra hur bred en genre är).
async function searchCount(query, limit = 25) {
  const j = await wd({ action: "query", list: "search", srsearch: query, srlimit: limit, srnamespace: 0, srinfo: "totalhits", srprop: "" });
  return { ids: ((j.query && j.query.search) || []).map((x) => x.title), total: (j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0 };
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
      const j = await wd({ action: "wbsearchentities", search: name, language: "sv", uselang: "sv", type: "item", limit: 4 });
      const ids = (j.search || []).map((s) => s.id);
      if (!ids.length) return null;
      const ents = await entities(ids, "claims|sitelinks|labels");
      // Flera personer kan heta likadant: välj den mest kända.
      const humans = ids.map((id) => ents[id]).filter((e) => claimIds(e, "P31").includes("Q5"));
      return humans.sort((a, b) => popularity(b) - popularity(a))[0] || null;
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
// Allt hämtas parallellt och avbryts efter högst ~5 s; det som hunnit hämtas visas.
// kind: "fiction" (skönlitteratur), "nonfiction" (sakprosa) eller "any" – styrs av dina egna taggar.
// Yrken som tyder på sakprosa (inte de generella "författare"/"skribent").
const NONFIC_OCC = ["Q14467526", "Q11774202", "Q1930187", "Q4964182", "Q201788", "Q2306091", "Q1238570", "Q188094", "Q4263842",
  "Q1086863", "Q15253558", "Q4773904", "Q212980", "Q1792450", "Q18814623", "Q6430706"];
// Ämnesord i Open Library som säger för lite för att jämföra på.
const OL_GENERIC = /^(sweden|russia|france|germany|england|great britain|united states|europe|human beings|man-woman relationships|interpersonal relations|women|men|families|family|love|death|social life and customs|history and criticism|fiction|literature|history|biography|criticism|translations?|accessible book|protected daisy|in library|large type books|lending library|open_syllabus|nyt:|new york times|reading level|swedish|english|american|french|german|russian|general|textbooks?|social conditions|politics and government|juvenile|essays?$|ficci|roman|novela|romans|fiction, general|literary fiction|classic|classics|long now|overdrive|internet archive|readers)/i;

const within = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), Math.max(0, ms)))]);

// Open Library: författarens mest specifika ämnen → andra författare med samma ämnen.
async function olSubjectPeers(name, kind) {
  const w = await getJson("https://openlibrary.org/search.json?author=" + encodeURIComponent(name) + "&fields=subject&limit=15", 4000);
  const count = new Map();
  for (const d of w.docs || []) for (const sub of (d.subject || []).slice(0, 25)) {
    const t = sub.trim();
    if (t.length < 4 || t.length > 40 || OL_GENERIC.test(t) || /\d{3}/.test(t)) continue;
    count.set(t, (count.get(t) || 0) + 1);
  }
  const subjects = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  if (!subjects.length) return { subjects: [], names: new Map() };
  const names = new Map();
  const extra = kind === "fiction" ? "&subject=fiction" : "";
  await Promise.all(subjects.map(async (sub) => {
    const r = await getJson("https://openlibrary.org/search.json?subject=" + encodeURIComponent(sub) + extra + "&fields=author_name&limit=100", 4000).catch(() => ({}));
    for (const d of r.docs || []) for (const a of (d.author_name || []).slice(0, 1)) {
      if (normName(a) === normName(name)) continue;
      const cur = names.get(a) || { n: 0, subs: new Set() };
      cur.n++; cur.subs.add(sub); names.set(a, cur);
    }
  }));
  return { subjects, names };
}

// Sökfilter (CirrusSearch) för typ av författare, så att kandidaterna inte behöver hämtas i sin helhet
// (en känd författares fullständiga Wikidata-post kan vara flera hundra kB).
const occFilter = (ids) => "haswbstatement:" + ids.map((o) => "P106=" + o).join("|P106=");
const KIND_FILTER = {
  // Skådespelare, regissörer och musiker som också skrivit något hålls utanför.
  fiction: occFilter(LIT_OCC) + " -haswbstatement:P106=Q33999 -haswbstatement:P106=Q2526255 -haswbstatement:P106=Q177220 -haswbstatement:P106=Q639669",
  nonfiction: occFilter(NONFIC_OCC),
  any: occFilter([...LIT_OCC, ...GEN_OCC, ...NONFIC_OCC])
};
const BROAD_GENRE = /^(skönlitteratur|fiktion|barnlitteratur|ungdomslitteratur|roman|novell|poesi|lyrik|essä|icke-fiktion|sakprosa|drama|prosa|litteratur|fiction|non-fiction|novel|poetry|essay|children's literature|literary fiction)$/i;

// Födelseår via Wikidatas REST-API: ett litet anrop per person i stället för hela posten.
// Högst 8 anrop åt gången, för att inte belasta Wikidata (som annars svarar "för många anrop").
async function birthYears(ids) {
  const out = {}, queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const j = await getJson(`https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${id}/statements?property=P569`, 2500);
        const t = j.P569 && j.P569[0] && j.P569[0].value && j.P569[0].value.content && j.P569[0].value.content.time;
        if (t) out[id] = parseInt(t.slice(0, 5), 10);
      } catch { /* hoppa över */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  return out;
}

// Sökning sorterad på antal inkommande länkar (≈ hur känd personen är).
async function rankedSearch(query, limit = 30) {
  const j = await wd({ action: "query", list: "search", srsearch: query, srlimit: limit, srnamespace: 0, srsort: "incoming_links_desc", srinfo: "totalhits", srprop: "" });
  return { ids: (j.query && j.query.search || []).map((s) => s.title), total: (j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0 };
}

export async function getSimilar(name, { refresh = false, kind = "any" } = {}) {
  const ck = kind + ":" + name;
  if (!refresh) { const c = cached("similar", ck); if (c) return c; }
  const t0 = Date.now();
  const left = () => 5000 - (Date.now() - t0);
  const KF = KIND_FILTER[kind] || KIND_FILTER.any;
  const olP = within(olSubjectPeers(name, kind), 4500, { subjects: [], names: new Map() });
  const author = await within(findAuthor(name), 2500, null);
  const cand = new Map(); // id → { reasons:Set, rank:number, direct, specific }
  const add = (id, why, rank = 30, extra = {}) => {
    if (!author || id === author.id) return;
    const c = cand.get(id) || { reasons: new Set(), rank: 0, direct: false, specific: 0, movement: false };
    c.reasons.add(why);
    c.rank = Math.max(c.rank, Math.max(0, 40 - rank));
    if (extra.direct) c.direct = true;
    if (extra.specific) c.specific++;
    if (extra.movement) c.movement = true;
    cand.set(id, c);
  };

  if (author) {
    const influences = claimIds(author, "P737");
    const movements = claimIds(author, "P135").slice(0, 2);
    const topWorks = claimIds(author, "P800").slice(0, 5);
    // Samma land/epok-sökningen använder författarens egna yrken (t.ex. journalist), så att
    // en journalist inte får lingvister bara för att de också räknas som sakprosa.
    const kindOcc = kind === "fiction" ? LIT_OCC : kind === "nonfiction" ? NONFIC_OCC : [...LIT_OCC, ...GEN_OCC, ...NONFIC_OCC];
    const ownOcc = claimIds(author, "P106").filter((o) => kindOcc.includes(o) && !GEN_OCC.includes(o)).slice(0, 4);
    // Politiker hålls utanför (många är också journalister eller författare).
    const eraKF = (ownOcc.length ? occFilter(ownOcc) + (kind === "fiction" ? KIND_FILTER.fiction.slice(occFilter(LIT_OCC).length) : "") : KF) + " -haswbstatement:P106=Q82955";
    influences.forEach((id, i) => add(id, "Inspirerade författaren", i, { direct: true }));

    // Reserv för författare utan kända influenser eller rörelser: samma land/språk och epok.
    const eraP = (influences.length || movements.length) ? Promise.resolve([]) : within((async () => {
      const born = year(author, "P569"), country = claimIds(author, "P27")[0], lang = claimIds(author, "P1412")[0];
      if (!born || (!country && !lang)) return [];
      // Först författarens egna yrken, sedan bredare (alla av samma typ) om det behövs.
      const broadKF = KF + " -haswbstatement:P106=Q82955";
      const qs = [country && `haswbstatement:P27=${country} ${eraKF}`, country && eraKF !== broadKF && `haswbstatement:P27=${country} ${broadKF}`,
        lang && `haswbstatement:P1412=${lang} ${eraKF}`].filter(Boolean);
      const res = await Promise.all(qs.map((q, i) => rankedSearch(q, i < 2 ? 30 : 15).catch(() => ({ ids: [] }))));
      const ids = [...new Set(res.flatMap((r) => r.ids))].filter((id) => id !== author.id).slice(0, 50);
      const [births, cl] = await Promise.all([birthYears(ids), country ? entities([country], "labels").catch(() => ({})) : {}]);
      const cn = label(cl[country]);
      return ids.filter((id) => births[id] && Math.abs(births[id] - born) <= 20)
        .map((id, i) => [id, cn ? `Samma land och epok (${cn})` : "Samma land och epok", i]);
    })(), left() - 1200, []);

    const [influenced, movRes, worksEnt, movLabels] = await Promise.all([
      within(rankedSearch(`haswbstatement:P737=${author.id} ${KF}`, 30), left() - 2600, { ids: [] }),
      Promise.all(movements.map((m) => within(rankedSearch(`haswbstatement:P135=${m} ${KF}`, 30), left() - 2600, { ids: [] }))),
      topWorks.length ? within(entities(topWorks, "claims"), left() - 2600, {}) : {},
      movements.length ? within(entities(movements, "labels"), left() - 2600, {}) : {}
    ]);
    influenced.ids.forEach((id, i) => add(id, "Påverkad av författaren", i, { direct: true }));
    movements.forEach((m, i) => {
      const n = label(movLabels[m]);
      (movRes[i].ids || []).forEach((id, r) => add(id, n ? `Samma rörelse: ${n}` : "Samma rörelse", r, { movement: true }));
    });

    // Genrer: egna + sådana som går igen i minst två huvudverk. Breda genrer hoppas över.
    const wc = new Map();
    topWorks.forEach((w) => new Set(claimIds(worksEnt[w], "P136")).forEach((g) => wc.set(g, (wc.get(g) || 0) + 1)));
    const genres = [...new Set([...claimIds(author, "P136"), ...[...wc].filter(([, n]) => n >= 2).map(([g]) => g)])].slice(0, 4);
    if (genres.length && left() > 1200) {
      const [gl, res] = await Promise.all([
        within(entities(genres, "labels"), left() - 1000, {}),
        Promise.all(genres.map((g) => within(rankedSearch(`haswbstatement:P136=${g} ${KF}`, 30), left() - 1000, { ids: [], total: 0 })))
      ]);
      genres.forEach((g, i) => {
        const n = label(gl[g]);
        if (!res[i].total || res[i].total > 800 || BROAD_GENRE.test(n)) return;
        res[i].ids.forEach((id, r) => add(id, n ? `Samma genre: ${n}` : "Samma genre", r, { specific: true }));
      });
    }
    const era = await eraP;
    if (cand.size < 15) for (const [id, why, r] of era.slice(0, 30)) add(id, why, r);
  }

  // Namn (och alternativa namn, för att kunna sålla bort sådant du redan har) – lätta anrop.
  let out = [];
  const ids = [...cand.keys()].slice(0, 120);
  if (ids.length && left() > 150) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const parts = await Promise.all(chunks.map((c) => within(entities(c, "labels|aliases", "sv|en|mul"), Math.max(left() - 100, 400), {})));
    const ents = Object.assign({}, ...parts);
    for (const [id, c] of cand) {
      const e = ents[id], n = label(e);
      if (!n) continue;
      out.push({ name: n, names: variants(e), reasons: [...c.reasons],
        score: c.rank + (c.direct ? 150 : 0) + c.specific * 90 + (c.movement ? 60 : 0) + (c.reasons.size - 1) * 60 });
    }
  }

  // Open Library-ämnen förstärker kandidater som redan hittats (dess egna namnlistor är för brusiga).
  const ol = await olP;
  for (const [n, v] of ol.names) {
    const hit = out.find((x) => normName(x.name) === normName(n) || (x.names || []).some((y) => normName(y) === normName(n)));
    if (!hit) continue;
    hit.score += 60 + v.n * 10;
    hit.reasons.push("Liknande ämnen: " + [...v.subs].slice(0, 2).join(", "));
  }
  out = out.sort((a, b) => b.score - a.score).slice(0, 40);
  const data = { found: !!author || out.length > 0, similar: out, ms: Date.now() - t0 };
  if (out.length) store("similar", ck, data);
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
