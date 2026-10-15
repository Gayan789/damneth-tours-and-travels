// Translations for the five site languages.
//
//   node tools/i18n.mjs sync          bake the CMS content into the pages, mark every piece of text
//                                     with a translation key, and bring the catalogs in i18n/ up to date
//   node tools/i18n.mjs compile       write the language bundles in assets/i18n/ (build.mjs does this too)
//   node tools/i18n.mjs status        how much of each language is translated
//   node tools/i18n.mjs todo de       list the German text that still needs a translation
//   node tools/i18n.mjs check         exit code 1 if the pages or catalogs are out of date
//
// Where the text lives
//   Pages        English, in the HTML. Each sentence or label is a "unit" (see lib/units.mjs) and
//                gets data-i18n="<key>"; translatable attributes get data-i18n-attr="alt=<key>|…".
//                Keys are a short hash of the English text, so the same text shares one translation.
//   Catalogs     i18n/<lang>/common.json (text on two or more pages) and i18n/<lang>/<page>.json:
//                { "<key>": { "en": "English", "<lang>": "translation" } }. Translations of text that
//                has gone from the site are kept in _orphans.json and come back if the text does.
//   Script text  i18n/<lang>/strings.json: "t" (messages from main.js), "label" (trip planner names)
//                and "bake" (the sentences that wrap the CMS content).
//   CMS content  translated in the admin panel; stored next to the English in content/**.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, findAll, attr, Splicer } from './lib/html.mjs';
import { collect, hashKey, isFixedKey, placeholders, ATTRS } from './lib/units.mjs';
import { bake, PAGES, ROOT, languages, attrKeyList } from './bake.mjs';

const STATUS = 'draft – needs native review';
const BUNDLES = ['common', ...PAGES];
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeIfChanged = (file, text) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ---------- pages ----------

/**
 * Adds data-i18n / data-i18n-attr keys to every unit and translatable attribute, and
 * data-i18n-page to <html>. Takes and returns { page: source }. Also returns, per page, the
 * text in document order: [{ key, source, fixed }].
 */
export function annotate(sources) {
  const parsed = {};
  const all = new Set();
  for (const [page, src] of Object.entries(sources)) {
    const { root } = parse(src);
    const found = collect(root);
    parsed[page] = { root, ...found };
    for (const u of found.units) if (!u.key) all.add(u.source);
    for (const a of found.attrs) all.add(a.source);
  }
  // Sorted, so a (very unlikely) hash collision always resolves the same way.
  const used = new Map();
  const keyOf = new Map([...all].sort().map((source) => [source, hashKey(source, used)]));

  const out = {};
  const entries = {};
  for (const [page, src] of Object.entries(sources)) {
    const { root, units, attrs } = parsed[page];
    const splicer = new Splicer(src);
    const list = [];
    const unitEls = new Set();
    for (const u of units) {
      unitEls.add(u.el);
      if (u.key) { list.push({ at: u.el.start, key: u.key, source: u.source, fixed: true }); continue; }
      const key = keyOf.get(u.source);
      splicer.setAttr(u.el, 'data-i18n', key);
      list.push({ at: u.el.start, key, source: u.source });
    }
    // Keys left on elements that no longer hold a unit.
    for (const el of findAll(root, (e) => e.attrs.has('data-i18n') && !unitEls.has(e))) {
      if (!isFixedKey(attr(el, 'data-i18n'))) splicer.removeAttr(el, 'data-i18n');
    }

    const byEl = new Map();
    for (const a of attrs) {
      if (!byEl.has(a.el)) byEl.set(a.el, []);
      byEl.get(a.el).push(a);
    }
    for (const el of findAll(root, (e) => e.attrs.has('data-i18n-attr'))) if (!byEl.has(el)) byEl.set(el, []);
    for (const [el, list2] of byEl) {
      const fixed = attrKeyList(attr(el, 'data-i18n-attr')).filter(([, key]) => isFixedKey(key));
      const fixedNames = new Set(fixed.map(([name]) => name));
      const pairs = [...fixed];
      const order = (name) => (ATTRS.includes(name) ? ATTRS.indexOf(name) : -1);
      for (const a of [...list2].sort((x, y) => order(x.name) - order(y.name))) {
        if (fixedNames.has(a.name)) {
          const key = fixed.find(([name]) => name === a.name)[1];
          list.push({ at: el.start + 0.5, key, source: a.source, fixed: true });
          continue;
        }
        const key = keyOf.get(a.source);
        pairs.push([a.name, key]);
        list.push({ at: el.start + 0.5, key, source: a.source });
      }
      const value = pairs.map(([name, key]) => `${name}=${key}`).join('|');
      if (value) splicer.setAttr(el, 'data-i18n-attr', value);
      else splicer.removeAttr(el, 'data-i18n-attr');
    }
    const html = findAll(root, (e) => e.tag === 'html')[0];
    if (html) splicer.setAttr(html, 'data-i18n-page', page);
    out[page] = splicer.apply();
    entries[page] = list.sort((a, b) => a.at - b.at).map(({ key, source, fixed }) => ({ key, source, fixed: !!fixed }));
  }
  return { pages: out, entries };
}

/** Bakes the CMS content and annotates the result. Writes the pages that changed when write is true. */
export function prepare({ root = ROOT, write = true, log = console.log } = {}) {
  const baked = bake({ root, write: false, log });
  const sources = Object.fromEntries(Object.entries(baked.pages).map(([page, p]) => [page, p.src]));
  const { pages, entries } = annotate(sources);
  const changed = [];
  for (const [page, p] of Object.entries(baked.pages)) {
    const out = p.crlf ? pages[page].replace(/\n/g, '\r\n') : pages[page];
    if (out !== p.original) {
      changed.push(`${page}.html`);
      if (write) fs.writeFileSync(p.file, out);
    }
  }
  return { ...baked, pages, entries, changed };
}

/** Which bundle each key belongs to: common when it is on two or more pages. */
function bundles(entries) {
  const pagesOf = new Map();
  const source = new Map();
  const order = [];
  for (const page of PAGES) {
    for (const e of entries[page] || []) {
      if (!pagesOf.has(e.key)) { pagesOf.set(e.key, new Set()); order.push(e); }
      pagesOf.get(e.key).add(page);
      source.set(e.key, e.source);
    }
  }
  const out = Object.fromEntries(BUNDLES.map((b) => [b, []]));
  for (const e of order) {
    const pages = pagesOf.get(e.key);
    out[pages.size > 1 ? 'common' : [...pages][0]].push(e);
  }
  return out;
}

// ---------- catalogs ----------

const catalogFile = (root, lang, bundle) => path.join(root, 'i18n', lang, `${bundle}.json`);

/** Every translation of a language, by English source, from all its catalogs and orphans. */
function translationIndex(root, lang) {
  const index = new Map();
  const dir = path.join(root, 'i18n', lang);
  if (!fs.existsSync(dir)) return index;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'strings.json');
  // Orphans first, so a live catalog wins when both have the text.
  files.sort((a, b) => (a === '_orphans.json' ? -1 : b === '_orphans.json' ? 1 : a.localeCompare(b)));
  for (const f of files) {
    const data = readJson(path.join(dir, f), {});
    for (const [key, entry] of Object.entries(data)) {
      if (key === '_meta' || !entry || typeof entry.en !== 'string') continue;
      if (typeof entry[lang] === 'string' && entry[lang].trim()) index.set(entry.en, entry[lang]);
    }
  }
  return index;
}

function aboutBundle(lang, bundle) {
  const where = bundle === 'common' ? 'Text that appears on more than one page (header, footer, shared buttons…).' : `Text on ${bundle}.html.`;
  return `${where} Translate the "${lang}" value of each entry. Keep the numbered markers exactly: <1>…</1> wraps words that are a link or styled, <2/> stands for an icon, price or number. Keep &amp; &lt; &gt; &nbsp; as they are. Leave a value empty to show the English.`;
}

/** Builds the catalogs for one language from the page text. Returns { file: object }. */
function buildCatalogs(root, lang, groups) {
  const index = translationIndex(root, lang);
  const files = {};
  const live = new Set();
  for (const bundle of BUNDLES) {
    const file = catalogFile(root, lang, bundle);
    const old = readJson(file, {});
    const data = { _meta: { ...(old._meta || {}), language: lang, bundle, status: old._meta?.status || STATUS, about: aboutBundle(lang, bundle) } };
    for (const e of groups[bundle]) {
      if (e.fixed) continue;
      live.add(e.source);
      data[e.key] = { en: e.source, [lang]: index.get(e.source) || '' };
    }
    files[file] = data;
  }
  const orphansFile = catalogFile(root, lang, '_orphans');
  const orphans = { _meta: { language: lang, about: 'Translations of text that is no longer on the site. They are reused automatically if the same English text comes back. Safe to delete.' } };
  for (const [source, translation] of [...index].sort(([a], [b]) => a.localeCompare(b))) {
    if (!live.has(source)) orphans[hashKey(source)] = { en: source, [lang]: translation };
  }
  files[orphansFile] = orphans;
  return files;
}

function stringsReport(root, lang) {
  const en = readJson(path.join(root, 'i18n/en/strings.json'), {});
  const own = readJson(path.join(root, 'i18n', lang, 'strings.json'), {});
  const missing = [];
  // The plural forms this language uses for the numbers the site shows (French "many" is only for millions).
  const rules = new Intl.PluralRules(lang);
  const forms = new Set(Array.from({ length: 201 }, (_, n) => rules.select(n)));
  for (const section of ['t', 'label', 'bake']) {
    for (const [name, value] of Object.entries(en[section] || {})) {
      const mine = own[section]?.[name];
      if (name === 'gallery_labels') {
        for (const label of Object.keys(value)) if (!mine?.[label]) missing.push(`${section}.${name}.${label}`);
      } else if (value && typeof value === 'object') {
        if (!mine || typeof mine !== 'object') missing.push(`${section}.${name}`);
        else for (const form of forms) if (!mine[form]) missing.push(`${section}.${name}.${form}`);
      } else if (!mine) missing.push(`${section}.${name}`);
    }
  }
  return missing;
}

export function sync({ root = ROOT, write = true, log = console.log } = {}) {
  const prepared = prepare({ root, write, log });
  const groups = bundles(prepared.entries);
  const outdated = [];
  for (const { code } of languages(root)) {
    if (code === 'en') continue;
    for (const [file, data] of Object.entries(buildCatalogs(root, code, groups))) {
      const text = json(data);
      const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
      if (same) continue;
      outdated.push(path.relative(root, file).replace(/\\/g, '/'));
      if (write) writeIfChanged(file, text);
    }
  }
  return { ...prepared, groups, outdated };
}

// ---------- bundles ----------

function resolveStrings(root, lang) {
  const own = readJson(path.join(root, 'i18n', lang, 'strings.json'), {});
  const clean = (section) => Object.fromEntries(Object.entries(own[section] || {}).filter(([, v]) => (typeof v === 'string' ? v.trim() : v && typeof v === 'object')));
  return { t: clean('t'), label: clean('label') };
}

function bundleScript(data) {
  const lines = [];
  for (const section of ['s', 't', 'label']) {
    if (!data[section]) continue;
    const body = Object.entries(data[section]).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    lines.push(`  ${section}: {\n${body}\n  }`);
  }
  return `/* Generated by tools/i18n.mjs from i18n/${data.lang}/ and content/. Do not edit. */\n`
    + `(window.__i18n = window.__i18n || []).push({\n  lang: ${JSON.stringify(data.lang)},\n  bundle: ${JSON.stringify(data.bundle)},\n${lines.join(',\n')}\n});\n`;
}

/** Writes assets/i18n/<lang>/<bundle>.js for every language but English, and the English script text into assets/js/i18n.js. */
export function compile({ root = ROOT, prepared, log = console.log } = {}) {
  prepared = prepared || prepare({ root, write: true, log });
  const groups = bundles(prepared.entries);
  const cmsPage = new Map();
  for (const page of PAGES) for (const e of prepared.entries[page]) if (e.fixed && e.key.startsWith('cms:')) cmsPage.set(e.key, cmsPage.has(e.key) && cmsPage.get(e.key) !== page ? 'common' : page);
  const written = [];
  const warnings = [];
  const stats = {};
  for (const { code } of languages(root)) {
    if (code === 'en') continue;
    const index = translationIndex(root, code);
    const strings = resolveStrings(root, code);
    let total = 0;
    let done = 0;
    for (const bundle of BUNDLES) {
      const s = {};
      for (const e of groups[bundle]) {
        if (e.fixed) continue;
        total += 1;
        const tr = index.get(e.source);
        if (!tr) continue;
        if (placeholders(tr) !== placeholders(e.source)) { warnings.push(`${code}: markers differ from English, so English is shown: ${e.key} "${tr}"`); continue; }
        done += 1;
        if (tr !== e.source) s[e.key] = tr;
      }
      for (const [key, page] of cmsPage) {
        if (page !== bundle) continue;
        const tr = prepared.cms[code][key];
        if (tr !== undefined && tr !== prepared.cms.en[key]) s[key] = tr;
      }
      const data = { lang: code, bundle, s };
      if (bundle === 'common') {
        data.t = strings.t;
        data.label = { ...prepared.labels[code], ...strings.label };
      }
      const file = path.join(root, 'assets/i18n', code, `${bundle}.js`);
      if (writeIfChanged(file, bundleScript(data))) written.push(path.relative(root, file).replace(/\\/g, '/'));
    }
    stats[code] = { total, done };
  }
  // English script text, used by i18n.t() as the fallback, lives inside i18n.js so it needs no extra request.
  const runtime = path.join(root, 'assets/js/i18n.js');
  if (fs.existsSync(runtime)) {
    const src = fs.readFileSync(runtime, 'utf8');
    const en = readJson(path.join(root, 'i18n/en/strings.json'), {}).t || {};
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const block = `  /* <en> generated by tools/i18n.mjs from i18n/en/strings.json */${eol}  var EN = ${JSON.stringify(en, null, 2).replace(/\n/g, `${eol}  `)};${eol}  /* </en> */`;
    const next = src.replace(/  \/\* <en>[\s\S]*?\/\* <\/en> \*\//, () => block);
    if (next !== src && writeIfChanged(runtime, next)) written.push('assets/js/i18n.js');
  }
  for (const w of warnings) log(`warning: ${w}`);
  return { written, warnings, stats };
}

// ---------- reports ----------

function status(root, prepared) {
  const groups = bundles(prepared.entries);
  const rows = [];
  for (const { code, name } of languages(root)) {
    if (code === 'en') continue;
    const index = translationIndex(root, code);
    let total = 0;
    let done = 0;
    for (const bundle of BUNDLES) for (const e of groups[bundle]) if (!e.fixed) { total += 1; if (index.has(e.source)) done += 1; }
    const cmsKeys = Object.keys(prepared.cms.en);
    const cmsDone = cmsKeys.filter((k) => prepared.cms[code][k] !== undefined && prepared.cms[code][k] !== prepared.cms.en[k]).length;
    const meta = readJson(catalogFile(root, code, 'common'), {})._meta || {};
    rows.push(`${name.padEnd(8)} pages ${done}/${total}   content ${cmsDone}/${cmsKeys.length} differ from English   script text missing: ${stringsReport(root, code).length}   (${meta.status || STATUS})`);
  }
  return rows;
}

function todo(root, prepared, lang) {
  const groups = bundles(prepared.entries);
  const index = translationIndex(root, lang);
  const out = [];
  for (const bundle of BUNDLES) for (const e of groups[bundle]) if (!e.fixed && !index.has(e.source)) out.push(`i18n/${lang}/${bundle}.json  ${e.key}  ${e.source}`);
  for (const name of stringsReport(root, lang)) out.push(`i18n/${lang}/strings.json  ${name}`);
  return out;
}

// ---------- command line ----------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'sync', arg] = process.argv.slice(2);
  try {
    if (command === 'sync') {
      const r = sync();
      console.log(r.changed.length ? `Pages updated: ${r.changed.join(', ')}` : 'Pages up to date');
      console.log(r.outdated.length ? `Catalogs updated: ${r.outdated.length} files` : 'Catalogs up to date');
      for (const row of status(ROOT, r)) console.log(row);
    } else if (command === 'compile') {
      const r = compile();
      console.log(r.written.length ? `Wrote ${r.written.length} files` : 'Bundles up to date');
    } else if (command === 'status') {
      for (const row of status(ROOT, prepare({ write: false }))) console.log(row);
    } else if (command === 'todo') {
      if (!arg) throw new Error('Usage: node tools/i18n.mjs todo <language code>');
      const list = todo(ROOT, prepare({ write: false }), arg);
      console.log(list.length ? list.join('\n') : `Nothing left to translate in ${arg}`);
    } else if (command === 'check') {
      const r = sync({ write: false });
      const stale = [...r.changed, ...r.outdated];
      console.log(stale.length ? `Out of date (run node tools/i18n.mjs sync): ${stale.join(', ')}` : 'Pages and catalogs up to date');
      process.exitCode = stale.length ? 1 : 0;
    } else {
      throw new Error(`Unknown command "${command}". Use sync, compile, status, todo <lang> or check.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
