// Writes the CMS-managed parts of the pages from the files in content/:
//
//   journeys.html   <!-- cms:journeys-jump --> and <!-- cms:journeys -->   (content/journeys/*.json)
//   gallery.html    <!-- cms:gallery-jump -->, -filters, -grid and the lead (content/gallery/*.json)
//   every page      elements with data-price="…"                            (content/settings/prices.json)
//
// The English text goes straight into the HTML. Every piece of content text is marked with a
// fixed translation key (data-i18n="cms:…"), and bake() also returns the text for the other
// languages, taken from the translated fields in the content files and the "bake" templates in
// i18n/<lang>/strings.json. tools/i18n.mjs turns that into the language bundles.
//
// Run it through tools/i18n.mjs (sync, check) or tools/build.mjs, which also add the translation
// keys for the fixed text around the content. bake({ write: false }) leaves the files alone and
// returns the new page sources in `pages`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, findAll, attr, escapeAttr, escapeText, decode, Splicer } from './lib/html.mjs';
import { collect, attrSource, placeholders, fill } from './lib/units.mjs';
import { imageSize, videoDuration } from './lib/media.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES = ['index', 'destinations', 'experiences', 'journeys', 'journal', 'gallery'];
const WHATSAPP = '94773980966';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const collapse = (text) => String(text ?? '').replace(/[ \t\r\n\f]+/g, ' ').trim();
const esc = (text) => escapeText(collapse(text));
const filled = (value) => typeof value === 'string' && value.trim() !== '';
const pad2 = (n) => String(n).padStart(2, '0');

export function languages(root = ROOT) {
  return readJson(path.join(root, 'i18n/languages.json'));
}

/** Content entries of a folder, as { slug, data } sorted by the English "order" field. Hidden entries are left out. */
function loadFolder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const data = readJson(path.join(dir, f));
      if (!data.en) throw new Error(`${path.basename(dir)}/${f}: no English ("en") version`);
      return { slug: f.slice(0, -5), data };
    })
    .filter((entry) => !entry.data.en.hidden)
    .sort((a, b) => (Number(a.data.en.order) || 0) - (Number(b.data.en.order) || 0) || a.slug.localeCompare(b.slug));
}

/** Reads a field in one language, falling back to English when it has not been translated. */
function localized(entry, lang) {
  const en = entry.data.en;
  const loc = entry.data[lang] || {};
  const text = (field) => (filled(loc[field]) ? loc[field] : en[field]);
  const item = (list, index, field) => {
    const translated = loc[list] && loc[list][index];
    const value = field ? translated && translated[field] : translated;
    if (filled(value)) return value;
    const source = en[list][index];
    return field ? source[field] : source;
  };
  return { en, text, item };
}

/** Templates and labels for one language, with English as the fallback. */
function templates(root, lang) {
  const load = (code) => {
    const file = path.join(root, 'i18n', code, 'strings.json');
    return fs.existsSync(file) ? readJson(file).bake || {} : {};
  };
  const en = load('en');
  const own = lang === 'en' ? en : load(lang);
  const T = (name) => own[name] ?? en[name];
  const L = (name) => (own.gallery_labels && filled(own.gallery_labels[name]) ? own.gallery_labels[name] : en.gallery_labels[name]);
  const F = (name, vars) => fill(T(name), vars, lang);
  return { T, L, F };
}

// ---------- images and videos ----------

const webPath = (file) => encodeURI(file.replace(/^\//, ''));

/**
 * Finds the size variants of an image (photo-480.webp, photo-960.webp…) and picks the src that
 * is at least `target` pixels wide. Uploads without variants get Netlify Image CDN sizes when
 * the build runs on Netlify.
 */
function imageSet(root, file, target = 0) {
  const rel = file.replace(/^\//, '');
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error(`image not found: ${file}`);
  const dir = path.posix.dirname(rel);
  const m = /^(.*)-(\d+)\.(webp|jpe?g|png|avif)$/i.exec(path.posix.basename(rel));
  let variants = [];
  if (m) {
    const stem = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${stem}-(\\d+)\\.${m[3]}$`, 'i');
    variants = fs.readdirSync(path.join(root, dir))
      .map((f) => re.exec(f))
      .filter(Boolean)
      .map((x) => ({ w: Number(x[1]), path: `${dir}/${x[0]}` }))
      .sort((a, b) => a.w - b.w);
  }
  const largest = variants.length > 1 ? variants[variants.length - 1].path : rel;
  const size = imageSize(path.join(root, largest));
  if (!size) throw new Error(`cannot read the size of ${largest}`);
  if (variants.length < 2) {
    variants = [];
    if (process.env.NETLIFY) {
      const widths = [480, 960, 1600].filter((w) => w < size.width).concat(size.width);
      variants = widths.map((w) => ({ w, path: `/.netlify/images?url=${encodeURI('/' + rel)}&w=${w}`, cdn: true }));
    }
  }
  const url = (v) => (v.cdn ? v.path : webPath(v.path));
  const src = variants.length ? url(variants.find((v) => v.w >= target) || variants[variants.length - 1]) : webPath(rel);
  const srcset = variants.length ? variants.map((v) => `${url(v)} ${v.w}w`).join(', ') : '';
  return { src, srcset, href: webPath(largest), ...size };
}

function videoInfo(root, file) {
  const abs = path.join(root, file.replace(/^\//, ''));
  if (!fs.existsSync(abs)) throw new Error(`video not found: ${file}`);
  const seconds = Math.round(videoDuration(abs) || 0);
  return { href: webPath(file), seconds, time: `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}` };
}

// ---------- unit strings ----------

/** Turns a unit string back into HTML: parts[n] is the markup for <n/>, or [open, close] for <n>…</n>. */
export function renderUnit(unit, parts = {}) {
  return unit.replace(/<(\/?)(\d+)(\/?)>/g, (m, closing, n, self) => {
    const part = parts[n];
    if (part === undefined) throw new Error(`no markup for placeholder ${m} in "${unit}"`);
    if (self) return typeof part === 'string' ? part : part[0] + part[1];
    return closing ? part[1] : part[0];
  });
}

const plain = (unit) => decode(unit);

// ---------- journeys ----------

function journeyStrings(entry, lang, tpl) {
  const { en, text, item } = localized(entry, lang);
  const k = (s) => `cms:j.${en.anchor}.${s}`;
  const title = collapse(text('title'));
  const out = {
    [k('title')]: esc(title),
    [k('jump')]: `<1/>${esc(title)}`,
    [k('eyebrow')]: esc(text('eyebrow')),
    [k('intro')]: esc(text('intro')),
    [k('main_alt')]: esc(text('main_alt')),
    [k('second_alt')]: esc(text('second_alt')),
    [k('third_alt')]: esc(text('third_alt')),
    [k('plan')]: tpl.F('journey_plan', { title }),
    [k('show')]: tpl.F('journey_show', { n: en.days.length }),
    [k('len')]: tpl.F('journey_length', { n: en.days.length }),
    [k('add')]: tpl.F('journey_add', { title }),
    [k('fine')]: tpl.F('journey_fine', {}) + (filled(en.note) ? ` ${esc(text('note'))}` : ''),
  };
  en.route.forEach((stop, i) => { out[k(`route.${i + 1}`)] = `<1/>${esc(item('route', i))}`; });
  en.inclusions.forEach((inc, i) => { out[k(`inc.${i + 1}`)] = `<1/>${esc(item('inclusions', i, 'text'))}`; });
  en.days.forEach((day, i) => {
    const d = (s) => k(`day${i + 1}.${s}`);
    out[d('title')] = tpl.F('journey_day_title', { n: i + 1, title: collapse(item('days', i, 'title')) });
    out[d('text')] = esc(item('days', i, 'text'));
    out[d('stay')] = `<1/>${esc(item('days', i, 'stay'))}`;
  });
  return out;
}

const icon = (name, extra = '') => `<svg class="icon${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function collageImage(root, cls, file, altKey, alt, target, sizes) {
  const img = imageSet(root, file, target);
  const lines = [`<img class="${cls}" src="${escapeAttr(img.src)}"`];
  if (img.srcset) lines.push(`  srcset="${escapeAttr(img.srcset)}"`, `  sizes="${sizes}" width="${img.width}" height="${img.height}" loading="lazy" decoding="async"`);
  else lines.push(`  width="${img.width}" height="${img.height}" loading="lazy" decoding="async"`);
  lines.push(`  alt="${escapeAttr(alt)}" data-i18n-attr="alt=${altKey}">`);
  return lines;
}

function journeySection(root, entry, index, cms) {
  const en = entry.data.en;
  const a = en.anchor;
  const k = (s) => `cms:j.${a}.${s}`;
  const u = (s, parts) => renderUnit(cms[k(s)], parts);
  const dark = index % 2 === 1;
  const title = collapse(en.title);
  const wa = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi Damneth, I’d like a free quote for the ${title} journey.`)}`;
  const hidden = ['<span class="visually-hidden">', '</span>'];
  const L = [];
  L.push(`<!-- ============ ${title.replace(/-{2,}/g, '-')} ============ -->`);
  L.push(`<section class="journey${dark ? ' journey--dark journey--flip theme-dark' : ''}" id="${escapeAttr(a)}" aria-labelledby="${escapeAttr(a)}-title">`);
  L.push('  <div class="container journey__grid">');
  L.push('    <div class="journey__media reveal">');
  L.push('      <div class="collage">');
  for (const line of collageImage(root, 'collage__main', en.main_image, k('main_alt'), plain(cms[k('main_alt')]), 800, '(min-width: 64em) 40vw, 100vw')) L.push(`        ${line}`);
  for (const line of collageImage(root, 'collage__small', en.second_image, k('second_alt'), plain(cms[k('second_alt')]), 600, '(min-width: 64em) 20vw, 50vw')) L.push(`        ${line}`);
  for (const line of collageImage(root, 'collage__small', en.third_image, k('third_alt'), plain(cms[k('third_alt')]), 600, '(min-width: 64em) 20vw, 50vw')) L.push(`        ${line}`);
  L.push('      </div>');
  L.push(`      <p class="journey__length" aria-hidden="true"><strong>${en.days.length}</strong><span data-i18n="${k('len')}">${u('len')}</span></p>`);
  L.push('    </div>');
  L.push('    <div class="journey__body">');
  L.push(`      <p class="eyebrow" data-i18n="${k('eyebrow')}">${u('eyebrow')}</p>`);
  L.push(`      <h2 class="journey__title" id="${escapeAttr(a)}-title" data-i18n="${k('title')}">${u('title')}</h2>`);
  L.push(`      <p class="lead" data-i18n="${k('intro')}">${u('intro')}</p>`);
  L.push('      <div class="journey__route">');
  L.push(`        <p class="route__label" id="${escapeAttr(a)}-route">The route</p>`);
  L.push(`        <ol class="route" role="list" aria-labelledby="${escapeAttr(a)}-route">`);
  en.route.forEach((stop, i) => {
    L.push(`          <li class="route__stop" data-i18n="${k(`route.${i + 1}`)}">${u(`route.${i + 1}`, { 1: '<span class="route__dot" aria-hidden="true"></span>' })}</li>`);
  });
  L.push('        </ol>');
  L.push('      </div>');
  L.push('      <ul class="badges journey__badges" role="list">');
  en.inclusions.forEach((inc, i) => {
    L.push(`        <li class="badge" data-i18n="${k(`inc.${i + 1}`)}">${u(`inc.${i + 1}`, { 1: `<span class="badge__icon" aria-hidden="true">${icon(inc.icon || 'check')}</span>` })}</li>`);
  });
  L.push('      </ul>');
  L.push('      <details class="days">');
  L.push('        <summary>');
  L.push(`          <span class="days__icon" aria-hidden="true">${icon('route')}</span>`);
  L.push(`          <span data-i18n="${k('plan')}">${u('plan', { 1: hidden })}</span>`);
  L.push(`          <span class="days__hint" aria-hidden="true"><span class="days__hint-closed" data-i18n="${k('show')}">${u('show')}</span><span class="days__hint-open">Hide</span></span>`);
  L.push(`          ${icon('chevron-down', ' days__toggle')}`);
  L.push('        </summary>');
  L.push('        <ol class="days__list" role="list">');
  en.days.forEach((day, i) => {
    const d = (s) => `day${i + 1}.${s}`;
    L.push('          <li class="day">');
    L.push(`            <span class="day__marker" aria-hidden="true"><small>Day</small><strong>${i + 1}</strong></span>`);
    L.push('            <div>');
    L.push(`              <h3 class="day__title" data-i18n="${k(d('title'))}">${u(d('title'), { 1: hidden })}</h3>`);
    L.push(`              <p class="day__text" data-i18n="${k(d('text'))}">${u(d('text'))}</p>`);
    L.push(`              <p class="day__stay" data-i18n="${k(d('stay'))}">${u(d('stay'), { 1: icon(day.stay_icon === 'plane' ? 'plane' : 'bed') })}</p>`);
    L.push('            </div>');
    L.push('          </li>');
  });
  L.push('        </ol>');
  L.push('      </details>');
  L.push('      <div class="journey__actions">');
  L.push(`        <a class="btn btn--accent" href="${escapeAttr(wa)}" target="_blank" rel="noopener" data-wa-trip data-wa-journey="${escapeAttr(title)}">`);
  L.push(`          ${icon('whatsapp')}`);
  L.push('          Plan this on WhatsApp<span class="visually-hidden"> (opens in a new tab)</span>');
  L.push('        </a>');
  L.push(`        <a class="btn ${dark ? 'btn--outline' : 'btn--primary'}" href="index.html#plan" data-journey-quote="${escapeAttr(title)}">Get a free quote</a>`);
  L.push(`        <button class="trip-toggle${dark ? '' : ' trip-toggle--solid'}" type="button" aria-pressed="false" data-journey="${escapeAttr(title)}">`);
  L.push(`            ${icon('plus', ' icon-plus')}`);
  L.push(`            ${icon('check', ' icon-check')}`);
  L.push('            <span class="trip-toggle__text" aria-hidden="true" data-i18n-keep>Add to my trip</span>');
  L.push(`            <span class="visually-hidden" data-i18n="${k('add')}">${u('add')}</span>`);
  L.push('          </button>');
  L.push('      </div>');
  L.push(`      <p class="journey__fine" data-i18n="${k('fine')}">${u('fine', { 1: `<span data-price="multiDayRange">${escapeText(cms.$prices.multiDayRange)}</span>` })}</p>`);
  L.push('    </div>');
  L.push('  </div>');
  L.push('</section>');
  return L;
}

// ---------- gallery ----------

const CATEGORIES = ['wildlife', 'hills', 'coast', 'culture', 'guests'];
const JUMP_ORDER = ['wildlife', 'hills', 'coast', 'culture', 'videos'];
const FILTER_ORDER = ['all', 'coast', 'wildlife', 'culture', 'hills', 'guests', 'videos'];

function galleryGroups(en) {
  const groups = [];
  if (en.category && en.category !== 'guests') groups.push(en.category);
  if (en.with_guests || en.category === 'guests') groups.push('guests');
  if (en.type === 'video') groups.push('videos');
  return groups;
}

function galleryCounts(items) {
  const counts = { all: items.length };
  for (const entry of items) for (const g of galleryGroups(entry.data.en)) counts[g] = (counts[g] || 0) + 1;
  return counts;
}

function durationText(seconds, tpl) {
  if (seconds < 60) return tpl.F('seconds', { n: seconds });
  const rest = seconds % 60;
  return tpl.F('minutes', { n: Math.floor(seconds / 60) }) + (rest ? ` ${tpl.F('seconds', { n: rest })}` : '');
}

function galleryStrings(root, items, lang, tpl, media) {
  const out = {};
  for (const entry of items) {
    const { en, text } = localized(entry, lang);
    const k = (s) => `cms:g.${entry.slug}.${s}`;
    if (!CATEGORIES.includes(en.category) && en.category) throw new Error(`gallery/${entry.slug}: unknown category "${en.category}"`);
    out[k('title')] = esc(text('title'));
    out[k('alt')] = esc(text('alt'));
    const cat = en.category ? tpl.L(en.category) : '';
    const catText = en.type === 'video' ? (cat ? tpl.F('gallery_cat_video', { cat }) : tpl.F('gallery_video', {})) : escapeText(cat);
    if (catText) out[k('cat')] = catText;
    if (en.type === 'video') {
      const { seconds } = media(entry);
      out[k('valt')] = tpl.F('gallery_video_alt', { duration: durationText(seconds, tpl), duration$raw: true, alt: collapse(text('alt')) });
    }
  }
  const counts = galleryCounts(items);
  const photos = counts.all - (counts.videos || 0);
  const videos = counts.videos || 0;
  const parts = [photos && tpl.F('gallery_photos', { n: photos }), videos && tpl.F('gallery_videos', { n: videos })].filter(Boolean);
  const list = parts.length === 2 ? tpl.F('gallery_and', { a: parts[0], a$raw: true, b: parts[1], b$raw: true }) : parts[0] || '';
  out['cms:g.lead'] = tpl.F('gallery_lead', { items: list, items$raw: true });
  for (const c of FILTER_ORDER) {
    out[`cms:g.label.${c}`] = esc(tpl.L(c));
    out[`cms:g.filter.${c}`] = tpl.F('gallery_filter', { name: collapse(tpl.L(c)), n: counts[c] || 0 });
    if (JUMP_ORDER.includes(c)) out[`cms:g.jump.${c}`] = tpl.F('gallery_jump', { name: collapse(tpl.L(c)) });
  }
  return out;
}

function galleryJump(items, cms) {
  const counts = galleryCounts(items);
  return JUMP_ORDER.filter((c) => counts[c]).map((c) => {
    const key = `cms:g.jump.${c}`;
    return `<a class="jump__link" href="#gallery" data-gallery-jump="${c}" data-i18n="${key}">${renderUnit(cms[key], { 1: `<span class="jump__count">${counts[c]}</span>` })}</a>`;
  });
}

function galleryFilters(items, cms) {
  const counts = galleryCounts(items);
  return FILTER_ORDER.filter((c) => c === 'all' || counts[c]).map((c) => {
    const key = `cms:g.filter.${c}`;
    const label = `cms:g.label.${c}`;
    const inner = renderUnit(cms[key], { 1: ['<span class="filter__count">', '</span>'], 2: '<span class="visually-hidden">, </span>', 3: ['<span class="visually-hidden">', '</span>'] });
    return `<button class="filter__btn" type="button" aria-pressed="${c === 'all'}" data-filter="${c}" data-filter-name="${escapeAttr(plain(cms[label]))}" data-i18n="${key}" data-i18n-attr="data-filter-name=${label}">${inner}</button>`;
  });
}

const PORTRAIT_SIZES = '(min-width: 90em) 15rem, (min-width: 64em) 14rem, (min-width: 40em) 12rem, 38vw';
const LANDSCAPE_SIZES = '(min-width: 90em) 27rem, (min-width: 64em) 25rem, (min-width: 40em) 21rem, 62vw';

function galleryItem(root, entry, cms, media) {
  const en = entry.data.en;
  const k = (s) => `cms:g.${entry.slug}.${s}`;
  const title = plain(cms[k('title')]);
  const cat = cms[k('cat')] ? plain(cms[k('cat')]) : '';
  const groups = galleryGroups(en).join(' ');
  const attrKeys = (pairs) => pairs.filter(([, key]) => cms[key]).map(([name, key]) => `${name}=${key}`).join('|');
  const info = `<span class="gallery-tile__info" aria-hidden="true"><span class="gallery-tile__cat"${cat ? ` data-i18n="${k('cat')}"` : ''}>${cat ? cms[k('cat')] : ''}</span><span class="gallery-tile__title" data-i18n="${k('title')}">${cms[k('title')]}</span></span>`;
  const L = [];
  if (en.type === 'video') {
    const poster = imageSet(root, en.poster);
    const video = media(entry);
    const ratio = String(Number((poster.width / poster.height).toFixed(4)));
    L.push(`<li class="gallery-item gallery-item--video" data-filter-group="${groups}" style="--r: ${ratio}">`);
    L.push(`  <a class="gallery-tile gallery-tile--video" href="${escapeAttr(video.href)}" data-lightbox="video" data-poster="${escapeAttr(poster.href)}" data-width="${poster.width}" data-height="${poster.height}" data-title="${escapeAttr(title)}" data-category="${escapeAttr(cat)}" data-alt="${escapeAttr(plain(cms[k('alt')]))}" data-i18n-attr="${attrKeys([['data-title', k('title')], ['data-category', k('cat')], ['data-alt', k('alt')]])}">`);
    L.push(`    <img src="${escapeAttr(poster.href)}" width="${poster.width}" height="${poster.height}" loading="lazy" decoding="async" alt="${escapeAttr(plain(cms[k('valt')]))}" data-i18n-attr="alt=${k('valt')}">`);
    L.push(`    <span class="gallery-tile__play" aria-hidden="true"><svg class="icon"><use href="#i-play"/></svg></span>`);
    L.push(`    <span class="gallery-tile__time" aria-hidden="true">${video.time}</span>`);
  } else {
    const img = imageSet(root, en.image, 0);
    const ratio = String(Number((img.width / img.height).toFixed(4)));
    const sizes = img.width < img.height ? PORTRAIT_SIZES : LANDSCAPE_SIZES;
    L.push(`<li class="gallery-item" data-filter-group="${groups}" style="--r: ${ratio}">`);
    L.push(`  <a class="gallery-tile" href="${escapeAttr(img.href)}" data-lightbox="image"${img.srcset ? ` data-srcset="${escapeAttr(img.srcset)}"` : ''} data-width="${img.width}" data-height="${img.height}" data-title="${escapeAttr(title)}" data-category="${escapeAttr(cat)}" data-i18n-attr="${attrKeys([['data-title', k('title')], ['data-category', k('cat')]])}">`);
    L.push(`    <img src="${escapeAttr(img.src)}"`);
    if (img.srcset) L.push(`      srcset="${escapeAttr(img.srcset)}"`, `      sizes="${sizes}" width="${img.width}" height="${img.height}" loading="lazy" decoding="async"`);
    else L.push(`      width="${img.width}" height="${img.height}" loading="lazy" decoding="async"`);
    L.push(`      alt="${escapeAttr(plain(cms[k('alt')]))}" data-i18n-attr="alt=${k('alt')}">`);
    L.push(`    <span class="gallery-tile__zoom" aria-hidden="true"><svg class="icon"><use href="#i-expand"/></svg></span>`);
  }
  L.push(`    ${info}`);
  L.push('  </a>');
  L.push('</li>');
  return L;
}

// ---------- pages ----------

function replaceRegion(src, name, render) {
  const open = `<!-- cms:${name} -->`;
  const close = `<!-- /cms:${name} -->`;
  let from = 0;
  for (;;) {
    const start = src.indexOf(open, from);
    if (start === -1) return src;
    const end = src.indexOf(close, start);
    if (end === -1) throw new Error(`${open} has no ${close}`);
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const indent = src.slice(lineStart, start);
    if (/\S/.test(indent)) throw new Error(`${open} must start its own line`);
    const body = render().map((line) => (line ? indent + line : line)).join('\n');
    const before = src.slice(0, start + open.length) + '\n' + body + '\n' + indent;
    src = before + src.slice(end);
    from = before.length + close.length;
  }
}

/** Splits data-i18n-attr="alt=key|title=key" into [[name, key]…]. */
export const attrKeyList = (value) => (value || '').split('|').filter(Boolean).map((pair) => {
  const at = pair.indexOf('=');
  return [pair.slice(0, at), pair.slice(at + 1)];
});

/** Checks that every cms-keyed unit and attribute in the page matches the English text bake produced. */
function validate(page, src, en) {
  const problems = [];
  const { root } = parse(src);
  const { units } = collect(root);
  for (const unit of units) {
    if (!unit.key || !unit.key.startsWith('cms:')) continue;
    if (!(unit.key in en)) problems.push(`${page}: ${unit.key} is not produced by the content`);
    else if (unit.source !== en[unit.key]) problems.push(`${page}: ${unit.key}\n    page:    ${unit.source}\n    content: ${en[unit.key]}`);
  }
  for (const el of findAll(root, (e) => e.attrs.has('data-i18n-attr'))) {
    for (const [name, key] of attrKeyList(attr(el, 'data-i18n-attr'))) {
      if (!key.startsWith('cms:')) continue;
      const value = attr(el, name);
      if (value === null) problems.push(`${page}: ${key} is set on a missing ${name} attribute`);
      else if (!(key in en)) problems.push(`${page}: ${key} is not produced by the content`);
      else if (attrSource(value) !== en[key]) problems.push(`${page}: ${key} (${name})\n    page:    ${attrSource(value)}\n    content: ${en[key]}`);
    }
  }
  return problems;
}

export function bake({ root = ROOT, write = true, log = console.log } = {}) {
  const langs = languages(root).map((l) => l.code);
  const prices = readJson(path.join(root, 'content/settings/prices.json'));
  const money = (n) => `${prices.currency}${n}`;
  const priceText = {
    multiDay: money(prices.multi_day_from),
    multiDayRange: `${money(prices.multi_day_from)}–${money(prices.multi_day_to)}`,
    transfer: money(prices.transfer_from),
  };
  const journeys = loadFolder(path.join(root, 'content/journeys'));
  const gallery = loadFolder(path.join(root, 'content/gallery'));
  const anchors = new Set();
  for (const j of journeys) {
    const a = j.data.en.anchor;
    if (!/^[a-z][a-z0-9-]*$/.test(a || '')) throw new Error(`journeys/${j.slug}: the anchor "${a}" must be lower-case letters, numbers and dashes`);
    if (anchors.has(a)) throw new Error(`journeys/${j.slug}: anchor "${a}" is used twice`);
    anchors.add(a);
    if (!j.data.en.days?.length) throw new Error(`journeys/${j.slug}: no days`);
  }
  for (const g of gallery) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(g.slug)) throw new Error(`gallery/${g.slug}.json: file names must be lower-case letters, numbers and dashes`);
    const en = g.data.en;
    if (en.type && !['image', 'video'].includes(en.type)) throw new Error(`gallery/${g.slug}: the type must be "image" or "video", not "${en.type}"`);
    if (en.type === 'video') {
      if (!en.video) throw new Error(`gallery/${g.slug}: this is a video, so it needs a video file`);
      if (!en.poster) throw new Error(`gallery/${g.slug}: this is a video, so it needs a poster image (the still shown before it plays)`);
    } else if (!en.image) throw new Error(`gallery/${g.slug}: this is a photo, so it needs an image`);
  }

  const videoCache = new Map();
  const media = (entry) => {
    if (!videoCache.has(entry.slug)) videoCache.set(entry.slug, videoInfo(root, entry.data.en.video));
    return videoCache.get(entry.slug);
  };

  // Text for every language. Translations whose markup placeholders do not match English are dropped.
  const cms = {};
  const warnings = [];
  for (const lang of langs) {
    const tpl = templates(root, lang);
    cms[lang] = {};
    for (const j of journeys) Object.assign(cms[lang], journeyStrings(j, lang, tpl));
    Object.assign(cms[lang], galleryStrings(root, gallery, lang, tpl, media));
  }
  for (const lang of langs) {
    if (lang === 'en') continue;
    for (const [key, value] of Object.entries(cms[lang])) {
      if (placeholders(value) !== placeholders(cms.en[key])) {
        warnings.push(`${lang}: ${key} has different markup from English, so English is used: ${value}`);
        delete cms[lang][key];
      }
    }
  }

  const en = { ...cms.en, $prices: priceText };
  const regions = {
    'journeys-jump': () => journeys.map((j) => {
      const key = `cms:j.${j.data.en.anchor}.jump`;
      return `<a class="jump__link" href="#${escapeAttr(j.data.en.anchor)}" data-i18n="${key}">${renderUnit(en[key], { 1: icon('chevron-down') })}</a>`;
    }),
    journeys: () => journeys.flatMap((j, i) => [...(i ? [''] : []), ...journeySection(root, j, i, en)]),
    'gallery-jump': () => galleryJump(gallery, en),
    'gallery-filters': () => galleryFilters(gallery, en),
    'gallery-grid': () => gallery.flatMap((g) => galleryItem(root, g, en, media)),
  };

  const changed = [];
  const problems = [];
  const pages = {};
  for (const page of PAGES) {
    const file = path.join(root, `${page}.html`);
    const original = fs.readFileSync(file, 'utf8');
    const crlf = original.includes('\r\n');
    let src = original.replace(/\r\n/g, '\n');
    for (const name of src.match(/<!-- cms:([\w-]+) -->/g) || []) {
      const region = name.slice(9, -4);
      if (!regions[region]) throw new Error(`${page}.html: unknown region ${name}`);
      src = replaceRegion(src, region, regions[region]);
    }
    // Prices, and content text that sits outside the regions (single elements without markup).
    const { root: doc } = parse(src);
    const splicer = new Splicer(src);
    for (const el of findAll(doc, (e) => e.attrs.has('data-price'))) {
      const name = attr(el, 'data-price');
      if (!(name in priceText)) throw new Error(`${page}.html: unknown data-price="${name}"`);
      const inner = escapeText(priceText[name]);
      if (src.slice(el.openEnd, el.closeStart) !== inner) splicer.replace(el.openEnd, el.closeStart, inner);
    }
    for (const el of findAll(doc, (e) => /^cms:/.test(attr(e, 'data-i18n') || ''))) {
      const value = cms.en[attr(el, 'data-i18n')];
      if (value === undefined || placeholders(value)) continue;
      if (src.slice(el.openEnd, el.closeStart) !== value) splicer.replace(el.openEnd, el.closeStart, value);
    }
    src = splicer.apply();
    problems.push(...validate(page, src, cms.en));
    pages[page] = { file, original, src, crlf };
    const out = crlf ? src.replace(/\n/g, '\r\n') : src;
    if (out !== original) {
      changed.push(`${page}.html`);
      if (write) fs.writeFileSync(file, out);
    }
  }
  if (problems.length) throw new Error(`The pages do not match the content:\n  ${problems.join('\n  ')}`);
  for (const w of warnings) log(`warning: ${w}`);

  // Names of journeys in each language, for the trip planner (window.i18n.label).
  const labels = {};
  for (const lang of langs) {
    labels[lang] = {};
    for (const j of journeys) {
      const title = collapse(j.data.en.title);
      const own = collapse(localized(j, lang).text('title'));
      if (own !== title) labels[lang][title] = own;
    }
  }
  return { cms, labels, prices: priceText, pages, changed, warnings, counts: { journeys: journeys.length, gallery: gallery.length } };
}
