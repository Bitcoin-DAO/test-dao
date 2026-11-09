// Minimal offline renderer for .dc.html mock-ups: renders each screen in its default state.
(function () {
  const FONT_DIR = '__FONT_DIR__';
  const faces = [
    ['IBM Plex Sans', 400, 'ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2'],
    ['IBM Plex Sans', 500, 'ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2'],
    ['IBM Plex Sans', 600, 'ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2'],
    ['IBM Plex Sans', 700, 'ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2'],
    ['IBM Plex Mono', 500, 'ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2'],
    ['IBM Plex Mono', 600, 'ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2']
  ];
  const css = faces.map(([f, w, p]) => `@font-face{font-family:'${f}';font-weight:${w};src:url('${FONT_DIR}/${p}') format('woff2');}`).join('');
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  window.DCLogic = class { constructor() { this.props = {}; this.state = {}; } setState() {} forceUpdate() {} };

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const k of path.split('.')) { if (v == null) return undefined; v = v[k]; }
    return v;
  }
  const FULL = /^\{\{\s*([^}]+?)\s*\}\}$/;
  const PART = /\{\{\s*([^}]+?)\s*\}\}/g;

  function processChildren(node, scope) {
    for (const child of Array.from(node.childNodes)) processNode(child, scope);
  }

  function processNode(node, scope) {
    if (node.nodeType === 3) {
      if (node.nodeValue.includes('{{')) node.nodeValue = node.nodeValue.replace(PART, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'helmet' || tag === 'script' || tag === 'style') return;
    if (tag === 'sc-for') {
      const list = lookup((node.getAttribute('list') || '').replace(/^\{\{|\}\}$/g, ''), scope) || [];
      const as = node.getAttribute('as') || 'item';
      const frag = document.createDocumentFragment();
      list.forEach((item, i) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = node.innerHTML;
        const sub = Object.assign(Object.create(scope), { [as]: item, $index: i });
        processChildren(wrap, sub);
        while (wrap.firstChild) frag.appendChild(wrap.firstChild);
      });
      node.replaceWith(frag);
      return;
    }
    if (tag === 'sc-if') {
      const v = lookup((node.getAttribute('value') || '').replace(/^\{\{|\}\}$/g, ''), scope);
      if (v) {
        processChildren(node, scope);
        const frag = document.createDocumentFragment();
        while (node.firstChild) frag.appendChild(node.firstChild);
        node.replaceWith(frag);
      } else node.remove();
      return;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name, val = attr.value;
      if (name.startsWith('on')) { node.removeAttribute(name); continue; }
      if (name === 'defaultvalue') {
        node.removeAttribute(name);
        if (tag === 'textarea') node.textContent = val;
        else if (tag === 'select') { const o = node.querySelector(`option[value="${val}"]`); if (o) o.setAttribute('selected', ''); }
        else node.setAttribute('value', val);
        continue;
      }
      const m = val.match(FULL);
      if (m) {
        const v = lookup(m[1], scope);
        if (name === 'checked' || name === 'disabled') { if (v) node.setAttribute(name, ''); else node.removeAttribute(name); }
        else node.setAttribute(name, v == null ? '' : String(v));
      } else if (val.includes('{{')) {
        node.setAttribute(name, val.replace(PART, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); }));
      }
    }
    processChildren(node, scope);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const script = document.querySelector('script[data-dc-script]');
    let vals = {};
    if (script) {
      const Component = new Function(script.textContent + '\nreturn Component;')();
      vals = new Component().renderVals() || {};
    }
    const root = document.querySelector('x-dc');
    if (root) processChildren(root, vals);
    document.body.setAttribute('data-rendered', '1');
  });
})();
