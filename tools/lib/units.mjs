// Translation units: which elements hold a translatable piece of text, and how that text is
// written down. assets/js/i18n.js follows exactly the same rules in the browser, so if you
// change something here, change it there too.
//
// A unit is the smallest element that holds a whole sentence or label, including any inline
// markup inside it (links, <strong>, icons…). Its source text keeps that markup as numbered
// placeholders, so translators can move it around without touching HTML:
//
//   <p>Climb <strong>Sigiriya</strong> at dawn <svg…/></p>   →   Climb <1>Sigiriya</1> at dawn <2/>
//
// <n>…</n> wraps an inline element whose text is translated with the rest; <n/> stands for an
// element that is kept exactly as it is (icons, images, prices, phone numbers…).

import crypto from 'node:crypto';
import { attr, decode, escapeText } from './html.mjs';

export const INLINE = new Set(['a', 'strong', 'em', 'b', 'i', 'span', 'small', 'br', 'abbr', 'time', 'sup', 'sub', 'mark', 'q', 'cite', 'bdi', 's', 'u', 'wbr', 'label', 'button']);
export const OPAQUE_TAGS = new Set(['svg', 'img', 'br', 'wbr', 'video', 'audio', 'picture', 'input', 'select', 'textarea', 'iframe', 'canvas', 'object']);
export const SKIP = new Set(['script', 'style', 'template', 'svg', 'noscript', 'head']);
export const ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'data-title', 'data-category', 'data-alt', 'data-empty', 'data-text-on', 'data-text-off', 'data-filter-name'];

const LETTER = /\p{L}/u;

/** Keys written by the content baker (cms:…) or tied to strings.json (t:…) are fixed; others are content hashes. */
export const isFixedKey = (key) => /^(cms|t):/.test(key || '');

const skipped = (el) => SKIP.has(el.tag) || attr(el, 'translate') === 'no';

/** True when any text inside el (outside svg/script/style) contains a letter. */
function hasLetters(el) {
  for (const child of el.children) {
    if (child.type === 'text' && LETTER.test(decode(child.raw))) return true;
    if (child.type === 'element' && !SKIP.has(child.tag) && hasLetters(child)) return true;
  }
  return false;
}

export function isOpaque(el) {
  if (OPAQUE_TAGS.has(el.tag)) return true;
  if (el.attrs.has('data-i18n-keep') || el.attrs.has('data-price') || el.attrs.has('data-year')) return true;
  if (attr(el, 'translate') === 'no') return true;
  if (isFixedKey(attr(el, 'data-i18n'))) return true;
  if (el.tag === 'a' && /^(mailto|tel):/i.test(attr(el, 'href') || '')) return true;
  if (INLINE.has(el.tag) && !hasLetters(el)) return true;
  return false;
}


/** Checks the subtree (not entering opaque elements): all inline, and returns whether it has letters of its own. */
function inlineLetters(el) {
  let letters = false;
  for (const child of el.children) {
    if (child.type === 'text') { if (LETTER.test(decode(child.raw))) letters = true; continue; }
    if (child.type !== 'element') continue;
    if (isOpaque(child)) continue;
    if (!INLINE.has(child.tag)) return null;
    const inner = inlineLetters(child);
    if (inner === null) return null;
    if (inner) letters = true;
  }
  return letters;
}

const directLetters = (el) => el.children.some((c) => c.type === 'text' && LETTER.test(decode(c.raw)));

/** Writes a unit's content in placeholder form. Returns { source, elements } (elements[n] for placeholder n). */
export function serialize(el) {
  const elements = [null];
  const walkChildren = (node) => {
    let out = '';
    for (const child of node.children) {
      if (child.type === 'text') out += escapeText(decode(child.raw).replace(/[ \t\r\n\f]+/g, ' '));
      else if (child.type === 'element') {
        const n = elements.length;
        elements.push(child);
        out += isOpaque(child) ? `<${n}/>` : `<${n}>${walkChildren(child)}</${n}>`;
      }
    }
    return out;
  };
  const raw = walkChildren(el);
  return { source: raw.replace(/ {2,}/g, ' ').trim(), elements };
}

/** Text of an attribute in the same escaped form as unit text. */
export const attrSource = (value) => escapeText(value.replace(/[ \t\r\n\f]+/g, ' ').trim());

export const hashKey = (source, used) => {
  const full = crypto.createHash('sha1').update(source).digest('hex');
  let len = 8;
  while (used && used.has(full.slice(0, len)) && used.get(full.slice(0, len)) !== source) len += 2;
  if (used) used.set(full.slice(0, len), source);
  return full.slice(0, len);
};

/**
 * Finds every unit and translatable attribute in a parsed page.
 * Returns { units: [{ el, source, key }], attrs: [{ el, name, source }], stray: [{ el, text }] }
 * key is the element's existing fixed key (cms:/t:) or null.
 */
export function collect(root) {
  const units = [];
  const attrs = [];
  const stray = [];

  const addAttrs = (el) => {
    for (const name of ATTRS) {
      const value = attr(el, name);
      if (value && LETTER.test(value)) attrs.push({ el, name, source: attrSource(value) });
    }
  };
  const addAttrsDeep = (el) => {
    addAttrs(el);
    for (const child of el.children) if (child.type === 'element' && !skipped(child)) addAttrsDeep(child);
  };

  const visit = (el) => {
    if (skipped(el)) return;
    if (el.tag === 'title' && el.parent && el.parent.tag === 'head') return;
    const fixed = attr(el, 'data-i18n');
    if (isFixedKey(fixed)) {
      units.push({ el, source: serialize(el).source, key: fixed });
      addAttrsDeep(el);
      return;
    }
    // A phone or email link inside a sentence is kept as it is, but a button-like one on its own
    // ("Call", "Email") still has a label to translate.
    if (isOpaque(el) && !(el.tag === 'a' && /^(mailto|tel):/i.test(attr(el, 'href') || ''))) { addAttrsDeep(el); return; }
    addAttrs(el);
    const letters = inlineLetters(el);
    if (letters && directLetters(el)) {
      units.push({ el, source: serialize(el).source, key: null });
      for (const child of el.children) if (child.type === 'element' && !skipped(child)) addAttrsDeep(child);
      return;
    }
    if (letters === null && directLetters(el)) {
      for (const child of el.children) {
        if (child.type === 'text' && LETTER.test(decode(child.raw))) stray.push({ el, text: decode(child.raw).trim() });
      }
    }
    for (const child of el.children) if (child.type === 'element') visit(child);
  };

  // <head>: the title and the meta description only.
  const head = findFirst(root, 'head');
  if (head) {
    for (const child of head.children) {
      if (child.type !== 'element') continue;
      if (child.tag === 'title') units.push({ el: child, source: serialize(child).source, key: null });
      if (child.tag === 'meta' && attr(child, 'name') === 'description') attrs.push({ el: child, name: 'content', source: attrSource(attr(child, 'content')) });
    }
  }
  const body = findFirst(root, 'body');
  if (body) visit(body);
  return { units, attrs, stray };
}

function findFirst(node, tag) {
  for (const child of node.children || []) {
    if (child.type !== 'element') continue;
    if (child.tag === tag) return child;
    const found = findFirst(child, tag);
    if (found) return found;
  }
  return null;
}

/** Placeholder tokens of a unit string, for checking translations. */
export const placeholders = (source) => (source.match(/<\/?\d+\/?>/g) || []).sort().join(' ');

/** Fills {name} variables; values are escaped. Plural objects are resolved with Intl.PluralRules. */
export function fill(template, vars, lang) {
  let text = template;
  if (text && typeof text === 'object') {
    const rule = new Intl.PluralRules(lang).select(vars.n ?? 0);
    text = text[rule] ?? text.other;
  }
  return String(text).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? (vars[name + '$raw'] ? vars[name] : escapeText(String(vars[name]))) : m));
}
