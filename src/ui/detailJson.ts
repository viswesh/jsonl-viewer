const COLLAPSE_THRESHOLD = 50;
const COLLAPSE_DEPTH = 4;

function leaf(cls: string, text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function entryLabel(key: string | null): DocumentFragment {
  const f = document.createDocumentFragment();
  if (key !== null) {
    f.appendChild(leaf('tok-key', key));
    f.appendChild(leaf('tok-punct', ': '));
  }
  return f;
}

function node(key: string | null, value: unknown, depth: number): HTMLElement {
  if (value === null || typeof value !== 'object') {
    const wrap = document.createElement('div');
    wrap.className = 'json-entry';
    wrap.appendChild(entryLabel(key));
    const cls = typeof value === 'string' ? 'tok-str' : typeof value === 'number' ? 'tok-num' : 'tok-bool';
    wrap.appendChild(leaf(cls, typeof value === 'string' ? JSON.stringify(value) : String(value)));
    return wrap;
  }

  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const details = document.createElement('details');
  details.className = 'json-node';
  details.open = !(entries.length > COLLAPSE_THRESHOLD || depth > COLLAPSE_DEPTH);
  const summary = document.createElement('summary');
  summary.appendChild(entryLabel(key));
  summary.appendChild(leaf('tok-punct', `${isArr ? '[' : '{'} ${entries.length} ${isArr ? 'items' : 'keys'} ${isArr ? ']' : '}'}`));
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'json-children';
  details.appendChild(body);
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    for (const [k, v] of entries) body.appendChild(node(isArr ? null : k, v, depth + 1));
  };
  if (details.open) build();
  details.addEventListener('toggle', () => {
    if (details.open) build();
  });
  return details;
}

export function renderJsonTree(value: unknown, container: HTMLElement): void {
  container.textContent = '';
  // No synthetic wrapper for the root: render its entries directly so the
  // first collapsible node found in the DOM is a real child node, not an
  // always-present root toggle around the whole document.
  if (value !== null && typeof value === 'object') {
    const isArr = Array.isArray(value);
    const entries = isArr
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) container.appendChild(node(isArr ? null : k, v, 0));
  } else {
    container.appendChild(node(null, value, 0));
  }
}
