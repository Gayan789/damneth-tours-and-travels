// A small HTML parser for this site's own hand-written pages. It keeps the source offsets of
// every tag and attribute, so the build tools can splice changes into the original text
// without reformatting anything. No dependencies.

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style']);
const RCDATA = new Set(['title', 'textarea']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', times: '×', reg: '®', trade: '™', deg: '°' };

export const decode = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
  if (name[0] === '#') {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? match;
});

export const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
export const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Parses a document into a tree.
 * element: { type, tag, attrs: Map(name -> { value, raw, start, end }), start, openEnd, closeStart, end, children, parent, selfClosing }
 *   start/openEnd span the start tag, closeStart/end the end tag (both equal openEnd when there is none).
 * text:    { type, raw, start, end, parent }   raw is undecoded source text
 */
export function parse(src) {
  const root = { type: 'root', tag: '#root', children: [], attrs: new Map(), start: 0, end: src.length };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const warnings = [];
  let i = 0;

  const addText = (start, end) => {
    if (end > start) top().children.push({ type: 'text', raw: src.slice(start, end), start, end, parent: top() });
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { addText(i, src.length); break; }
    addText(i, lt);

    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4);
      const end = close === -1 ? src.length : close + 3;
      top().children.push({ type: 'comment', raw: src.slice(lt, end), start: lt, end, parent: top() });
      i = end;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt) + 1 || src.length;
      top().children.push({ type: 'doctype', raw: src.slice(lt, end), start: lt, end, parent: top() });
      i = end;
      continue;
    }
    if (src[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(lt, lt + 200));
      if (!m) { addText(lt, lt + 1); i = lt + 1; continue; }
      const tag = m[1].toLowerCase();
      const end = lt + m[0].length;
      let k = stack.length - 1;
      while (k > 0 && stack[k].tag !== tag) k -= 1;
      if (k === 0) {
        warnings.push(`stray </${tag}> at ${lt}`);
      } else {
        if (k !== stack.length - 1) warnings.push(`implicitly closed <${stack.slice(k + 1).map((n) => n.tag).join('>, <')}> before </${tag}> at ${lt}`);
        while (stack.length - 1 > k) {
          const open = stack.pop();
          open.closeStart = open.end = lt;
        }
        const el = stack.pop();
        el.closeStart = lt;
        el.end = end;
      }
      i = end;
      continue;
    }
    const nameMatch = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(lt, lt + 100));
    if (!nameMatch) { addText(lt, lt + 1); i = lt + 1; continue; }

    const tag = nameMatch[1].toLowerCase();
    const el = { type: 'element', tag, attrs: new Map(), start: lt, children: [], parent: top(), selfClosing: false };
    let j = lt + nameMatch[0].length;
    // Attributes
    for (;;) {
      while (/\s/.test(src[j])) j += 1;
      if (src[j] === '>') { j += 1; break; }
      if (src[j] === '/' && src[j + 1] === '>') { el.selfClosing = true; j += 2; break; }
      if (j >= src.length) break;
      const attrStart = j;
      const an = /^[^\s"'>\/=]+/.exec(src.slice(j, j + 200));
      if (!an) { j += 1; continue; }
      const name = an[0].toLowerCase();
      j += an[0].length;
      let k = j;
      while (/\s/.test(src[k])) k += 1;
      let raw = null;
      let quote = '';
      let valueStart = -1;
      let valueEnd = -1;
      if (src[k] === '=') {
        k += 1;
        while (/\s/.test(src[k])) k += 1;
        const q = src[k];
        if (q === '"' || q === "'") {
          const close = src.indexOf(q, k + 1);
          quote = q;
          valueStart = k + 1;
          valueEnd = close;
          raw = src.slice(k + 1, close);
          k = close + 1;
        } else {
          const um = /^[^\s>]+/.exec(src.slice(k, k + 2000));
          valueStart = k;
          valueEnd = k + (um ? um[0].length : 0);
          raw = um ? um[0] : '';
          k = valueEnd;
        }
        j = k;
      }
      el.attrs.set(name, { value: raw === null ? '' : decode(raw), raw, quote, start: attrStart, end: j, valueStart, valueEnd });
    }
    el.openEnd = j;
    top().children.push(el);

    if (VOID.has(tag) || el.selfClosing) {
      el.closeStart = el.end = j;
      i = j;
      continue;
    }
    if (RAW_TEXT.has(tag) || RCDATA.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, j);
      const closeStart = close === -1 ? src.length : close;
      if (closeStart > j) el.children.push({ type: 'text', raw: src.slice(j, closeStart), start: j, end: closeStart, parent: el, rawText: RAW_TEXT.has(tag) });
      const closeEnd = close === -1 ? src.length : src.indexOf('>', close) + 1;
      el.closeStart = closeStart;
      el.end = closeEnd;
      i = closeEnd;
      continue;
    }
    stack.push(el);
    i = j;
  }
  while (stack.length > 1) {
    const open = stack.pop();
    warnings.push(`unclosed <${open.tag}> at ${open.start}`);
    open.closeStart = open.end = src.length;
  }
  return { root, warnings };
}

/** Depth-first walk over elements (pre-order). Return false from fn to skip an element's children. */
export function walk(node, fn) {
  for (const child of node.children || []) {
    if (child.type !== 'element') continue;
    if (fn(child) === false) continue;
    walk(child, fn);
  }
}

export const attr = (el, name) => (el.attrs.has(name) ? el.attrs.get(name).value : null);
export const hasClass = (el, name) => (attr(el, 'class') || '').split(/\s+/).includes(name);

export function findAll(root, test) {
  const out = [];
  walk(root, (el) => { if (test(el)) out.push(el); });
  return out;
}

/** Collects text edits and applies them back to front. */
export class Splicer {
  constructor(src) { this.src = src; this.edits = []; }
  replace(start, end, text) { this.edits.push({ start, end, text }); }
  insert(at, text) { this.edits.push({ start: at, end: at, text }); }
  /** Sets (or adds) an attribute on a parsed element, keeping the rest of the tag untouched. */
  setAttr(el, name, value) {
    const current = el.attrs.get(name);
    const quoted = `"${escapeAttr(value)}"`;
    if (current) {
      if (current.value === value) return;
      const q = current.quote ? 1 : 0;
      if (current.valueStart >= 0) this.replace(current.valueStart - q, current.valueEnd + q, quoted);
      else this.replace(current.start, current.end, `${name}=${quoted}`);
    } else {
      const at = el.selfClosing ? this.src.lastIndexOf('/', el.openEnd - 1) : el.openEnd - 1;
      const before = this.src[at - 1];
      this.insert(at, `${/\s/.test(before) ? '' : ' '}${name}=${quoted}${el.selfClosing ? ' ' : ''}`);
    }
  }
  removeAttr(el, name) {
    const current = el.attrs.get(name);
    if (!current) return;
    let start = current.start;
    while (start > 0 && /[ \t]/.test(this.src[start - 1])) start -= 1;
    this.replace(start, current.end, '');
  }
  apply() {
    const edits = [...this.edits].sort((a, b) => b.start - a.start || b.end - a.end);
    let out = this.src;
    let last = Infinity;
    for (const e of edits) {
      if (e.end > last) throw new Error(`overlapping edits at ${e.start}-${e.end}`);
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
      last = e.start;
    }
    return out;
  }
}
