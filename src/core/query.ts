export type Term =
  | { kind: 'text'; value: string }
  | { kind: 'field'; path: string[]; op: ':' | '>' | '<' | 'exists'; value: string };

export interface Query { terms: Term[] }

const FIELD_RE = /^([\w.$-]+)([:><])(.*)$/;

export function parseQuery(input: string): Query {
  const terms: Term[] = [];
  for (const tok of input.trim().split(/\s+/).filter(Boolean)) {
    const m = FIELD_RE.exec(tok);
    if (m) {
      const path = m[1]!.split('.');
      const op = m[2] as ':' | '>' | '<';
      const value = m[3]!;
      terms.push(op === ':' && value === '*'
        ? { kind: 'field', path, op: 'exists', value: '' }
        : { kind: 'field', path, op, value });
    } else {
      terms.push({ kind: 'text', value: tok.toLowerCase() });
    }
  }
  return { terms };
}

/** Find value at exact path, or by bare key anywhere (DFS, first hit) when path.length === 1. */
function lookup(obj: unknown, path: string[]): { found: boolean; value: unknown } {
  const exact = (o: unknown, p: string[]): { found: boolean; value: unknown } => {
    let cur = o;
    for (const k of p) {
      if (cur === null || typeof cur !== 'object') return { found: false, value: undefined };
      if (!(k in (cur as Record<string, unknown>))) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[k];
    }
    return { found: true, value: cur };
  };
  if (path.length > 1) return exact(obj, path);
  // bare key: exact top-level first, then DFS
  const top = exact(obj, path);
  if (top.found) return top;
  const key = path[0]!;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === null || typeof cur !== 'object') continue;
    const rec = cur as Record<string, unknown>;
    if (key in rec) return { found: true, value: rec[key] };
    for (const v of Array.isArray(cur) ? cur : Object.values(rec)) stack.push(v);
  }
  return { found: false, value: undefined };
}

export function matchesLine(raw: string, query: Query, getParsed: () => unknown): boolean {
  let parsed: unknown;
  let parsedLoaded = false;
  for (const t of query.terms) {
    if (t.kind === 'text') {
      if (!raw.toLowerCase().includes(t.value)) return false;
      continue;
    }
    if (!parsedLoaded) { parsed = getParsed(); parsedLoaded = true; }
    if (parsed === undefined) return false;
    const { found, value } = lookup(parsed, t.path);
    if (t.op === 'exists') { if (!found) return false; continue; }
    if (!found) return false;
    if (t.op === ':') {
      if (String(value).toLowerCase() !== t.value.toLowerCase()) return false;
    } else {
      const n = typeof value === 'number' ? value : NaN;
      const q = Number(t.value);
      if (Number.isNaN(n) || Number.isNaN(q)) return false;
      if (t.op === '>' ? n <= q : n >= q) return false;
    }
  }
  return true;
}
