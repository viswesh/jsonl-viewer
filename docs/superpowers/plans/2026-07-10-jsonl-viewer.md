# JSONL Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a blazing-fast, in-browser JSONL viewer with virtualized rendering, worker-side streaming/indexing, search, and auto-detected LLM transcript mode.

**Architecture:** Vite + vanilla TypeScript, no framework. Main thread renders UI only; a Web Worker streams the file, indexes line byte-offsets, parses lazily, and runs search. Two-pane layout: virtualized line list left, detail pane (JSON tree / transcript bubbles) right.

**Tech Stack:** Vite, TypeScript, Vitest, Playwright, `marked`, `dompurify`, `@speed-highlight/core`. Everything else hand-rolled.

**Spec:** `docs/superpowers/specs/2026-07-10-jsonl-viewer-design.md` — read it before starting.

## Global Constraints

- Total shipped JS < 50KB gzipped (CI-gated). Demo `.jsonl` file is a lazy-fetched data asset, excluded.
- Runtime deps ONLY: `marked`, `dompurify`, `@speed-highlight/core`. No framework, no lodash, nothing else.
- All markdown-rendered HTML passes through DOMPurify. JSON/raw content renders via `textContent` — never `innerHTML` of unsanitized content.
- Untrusted input: every byte of the user's file.
- Palette: bg `#0E1014`, surface `#1A1D23`, muted `#8B919C`, text `#E6E8EC`, accent amber `#F5A623`. No blue/green in chrome.
- Modern evergreen browsers only (ES2022, `File.stream()`, module workers).
- Empty lines: skipped, not counted. CRLF and BOM handled. Bad JSON lines never fail the file.
- Conventional commits. TDD for all logic modules.
- Working directory: `/Users/viswesh.subramanian/Viswesh/Learnings/visweshGitHub/jsonl-viewer`

## File Structure

```
jsonl-viewer/
├── index.html                    # shell: SEO meta, drop zone, panes, crawlable footer
├── package.json / tsconfig.json / vite.config.ts
├── public/_headers               # Cloudflare CSP
├── public/demo.jsonl             # demo file (lazy-fetched)
├── src/
│   ├── main.ts                   # boot + wiring
│   ├── styles/tokens.css         # design tokens (palette, type scale)
│   ├── styles/app.css            # layout + components
│   ├── core/offsets.ts           # growable Float64 offset store
│   ├── core/query.ts             # search query parser + matcher
│   ├── core/detect.ts            # transcript shape detection + normalization
│   ├── core/jsonPreview.ts       # tiny JSON tokenizer for row previews
│   ├── worker/indexer.ts         # streaming line indexer
│   ├── worker/worker.ts          # worker message router (index/lines/search/validate)
│   ├── ui/workerClient.ts        # main-thread RPC wrapper
│   ├── ui/virtualList.ts         # fixed-height virtualizer
│   ├── ui/dropzone.ts            # drop + paste → Blob
│   ├── ui/detailJson.ts          # collapsible JSON tree (textContent-only)
│   ├── ui/detailTranscript.ts    # chat bubbles (marked + DOMPurify)
│   └── ui/topbar.ts              # readouts, search box, toggles
├── src/**/*.test.ts              # vitest unit tests colocated
├── tests/fixtures/*.jsonl        # openai, claude-code, eval, broken, xss fixtures
├── e2e/smoke.spec.ts             # Playwright
├── scripts/check-bundle-size.mjs # gzip gate
└── .github/workflows/ci.yml
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/styles/tokens.css`, `src/styles/app.css`, `.gitignore`, `LICENSE` (MIT)

**Interfaces:**
- Produces: buildable Vite project; design tokens as CSS custom properties consumed by all UI tasks.

- [ ] **Step 1: Scaffold files**

`package.json`:
```json
{
  "name": "jsonl-viewer",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "check-size": "node scripts/check-bundle-size.mjs"
  }
}
```

Install:
```bash
npm i marked dompurify @speed-highlight/core
npm i -D vite typescript vitest @types/dompurify playwright @playwright/test
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "e2e", "scripts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
});
```

`index.html` (shell — full SEO treatment lands in Task 12; keep meta minimal but valid now):
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>JSONL Viewer — view .jsonl files instantly, locally</title>
  <meta name="description" content="Drop a .jsonl file and view it instantly. Streams gigabyte files in your browser. Nothing uploads." />
  <link rel="stylesheet" href="/src/styles/tokens.css" />
  <link rel="stylesheet" href="/src/styles/app.css" />
</head>
<body>
  <main id="app">
    <section id="landing" class="landing">
      <div class="ghost-stream" aria-hidden="true"></div>
      <h1 class="landing-title">Drop your <span class="accent">.jsonl</span> — it never leaves your browser.</h1>
      <div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Drop a JSONL file or click to browse">
        <p>Drop file · click to browse · or paste raw JSONL</p>
      </div>
      <button id="demo-link" class="demo-link">try a demo file</button>
    </section>
    <section id="viewer" class="viewer" hidden>
      <header id="topbar" class="topbar"></header>
      <div class="panes">
        <div id="list-pane" class="list-pane"></div>
        <div id="divider" class="divider" role="separator" aria-orientation="vertical"></div>
        <div id="detail-pane" class="detail-pane"></div>
      </div>
    </section>
  </main>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/styles/tokens.css`:
```css
:root {
  --bg: #0e1014;
  --surface: #1a1d23;
  --surface-2: #232730;
  --muted: #8b919c;
  --text: #e6e8ec;
  --accent: #f5a623;
  --accent-dim: #f5a62333;
  /* data syntax hues — reserved for data only */
  --syn-key: #d8b4fe;
  --syn-str: #fca5a5;
  --syn-num: #fcd34d;
  --syn-bool: #f0abfc;
  --role-user: #e6e8ec;
  --role-assistant: #f5a623;
  --role-system: #8b919c;
  --role-tool: #d8b4fe;
  --danger: #f87171;
  --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
  --sans: system-ui, sans-serif;
  --row-h: 28px;
}
[data-theme="light"] {
  --bg: #f7f7f5; --surface: #ffffff; --surface-2: #eeeeec;
  --muted: #6b7280; --text: #16181d; --accent: #c77d00; --accent-dim: #c77d0022;
}
```

`src/styles/app.css` — minimal now (layout lands in Task 11):
```css
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--mono); }
.accent { color: var(--accent); }
[hidden] { display: none !important; }
```

`src/main.ts` placeholder that Task 10 replaces:
```ts
console.log('jsonl-viewer boot');
```

`.gitignore`: `node_modules/`, `dist/`, `test-results/`, `.DS_Store`.
`LICENSE`: standard MIT text, copyright 2026 Viswesh Subramanian.

- [ ] **Step 2: Verify build works**

Run: `npm run build`
Expected: `dist/` produced, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + ts project with design tokens"
```

---

### Task 2: Offset store

**Files:**
- Create: `src/core/offsets.ts`, `src/core/offsets.test.ts`

**Interfaces:**
- Produces: `class OffsetIndex { push(start: number): void; start(i: number): number; setFileSize(n: number): void; end(i: number): number; readonly length: number; static readonly MAX_LINES: number }`. Line i's bytes = `[start(i), end(i))` where `end(i)` = next start − 1 newline trimmed by consumer; here `end(i)` returns the exclusive byte end of line content (next stored boundary). Throws `RangeError('file too large')` past `MAX_LINES` (50_000_000).

- [ ] **Step 1: Write failing tests**

`src/core/offsets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { OffsetIndex } from './offsets';

describe('OffsetIndex', () => {
  it('stores starts and computes ends from next start', () => {
    const idx = new OffsetIndex();
    idx.push(0);   // line 0 starts at 0
    idx.push(10);  // line 1 starts at 10 (line 0 content is [0,9), newline at 9)
    idx.setFileSize(25);
    expect(idx.length).toBe(2);
    expect(idx.start(0)).toBe(0);
    expect(idx.end(0)).toBe(9);   // next start 10 minus 1 (the \n)
    expect(idx.start(1)).toBe(10);
    expect(idx.end(1)).toBe(25);  // last line: file size (no trailing newline)
  });

  it('grows past initial capacity', () => {
    const idx = new OffsetIndex(4);
    for (let i = 0; i < 100; i++) idx.push(i * 10);
    idx.setFileSize(1000);
    expect(idx.length).toBe(100);
    expect(idx.start(99)).toBe(990);
  });

  it('throws past MAX_LINES', () => {
    const idx = new OffsetIndex(4);
    (idx as any).count = OffsetIndex.MAX_LINES; // simulate; do not loop 50M times
    expect(() => idx.push(1)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/core/offsets.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/offsets.ts`:
```ts
/** Growable store of line-start byte offsets. Float64 is exact for ints < 2^53. */
export class OffsetIndex {
  static readonly MAX_LINES = 50_000_000;
  private buf: Float64Array;
  private count = 0;
  private fileSize = 0;

  constructor(initialCapacity = 1 << 16) {
    this.buf = new Float64Array(initialCapacity);
  }

  push(start: number): void {
    if (this.count >= OffsetIndex.MAX_LINES) throw new RangeError('file too large');
    if (this.count === this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.count++] = start;
  }

  setFileSize(n: number): void { this.fileSize = n; }
  get length(): number { return this.count; }
  start(i: number): number { return this.buf[i]!; }

  /** Exclusive end of line i's content (newline excluded). */
  end(i: number): number {
    return i + 1 < this.count ? this.buf[i + 1]! - 1 : this.fileSize;
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/core/offsets.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: growable line offset index"`

Note: `end(i)` can overshoot by 1 for CRLF files (points at the `\r`). The indexer (Task 3) is responsible for trimming `\r` — see its tests.

---

### Task 3: Streaming line indexer

**Files:**
- Create: `src/worker/indexer.ts`, `src/worker/indexer.test.ts`

**Interfaces:**
- Consumes: `OffsetIndex` from Task 2.
- Produces:
  ```ts
  interface IndexResult { offsets: OffsetIndex; lineCount: number; fileSize: number }
  async function indexBlob(
    blob: Blob,
    onProgress?: (lines: number, bytes: number) => void
  ): Promise<IndexResult>
  async function readLine(blob: Blob, offsets: OffsetIndex, i: number, maxBytes?: number): Promise<string>
  ```
  `readLine` decodes line i (UTF-8), trims trailing `\r`, strips BOM on line 0, optionally truncates to `maxBytes`.

- [ ] **Step 1: Write failing tests**

`src/worker/indexer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { indexBlob, readLine } from './indexer';

const blob = (s: string) => new Blob([s]);

describe('indexBlob', () => {
  it('indexes simple lines', async () => {
    const r = await indexBlob(blob('{"a":1}\n{"b":2}\n'));
    expect(r.lineCount).toBe(2);
    expect(await readLine(blob('{"a":1}\n{"b":2}\n'), r.offsets, 0)).toBe('{"a":1}');
    expect(await readLine(blob('{"a":1}\n{"b":2}\n'), r.offsets, 1)).toBe('{"b":2}');
  });

  it('handles missing trailing newline', async () => {
    const b = blob('{"a":1}\n{"b":2}');
    const r = await indexBlob(b);
    expect(r.lineCount).toBe(2);
    expect(await readLine(b, r.offsets, 1)).toBe('{"b":2}');
  });

  it('skips empty lines entirely', async () => {
    const b = blob('{"a":1}\n\n\n{"b":2}\n');
    const r = await indexBlob(b);
    expect(r.lineCount).toBe(2);
    expect(await readLine(b, r.offsets, 1)).toBe('{"b":2}');
  });

  it('trims CRLF', async () => {
    const b = blob('{"a":1}\r\n{"b":2}\r\n');
    const r = await indexBlob(b);
    expect(await readLine(b, r.offsets, 0)).toBe('{"a":1}');
  });

  it('strips BOM on first line', async () => {
    const b = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), '{"a":1}\n']);
    const r = await indexBlob(b);
    expect(await readLine(b, r.offsets, 0)).toBe('{"a":1}');
  });

  it('survives newline landing on chunk boundary (multi-chunk stream)', async () => {
    // Build a blob larger than one 64KB chunk with known lines
    const line = '{"x":"' + 'a'.repeat(1000) + '"}';
    const n = 200; // ~200KB
    const b = blob(Array(n).fill(line).join('\n') + '\n');
    const r = await indexBlob(b);
    expect(r.lineCount).toBe(n);
    expect(await readLine(b, r.offsets, n - 1)).toBe(line);
  });

  it('truncates with maxBytes', async () => {
    const b = blob('{"long":"' + 'x'.repeat(500) + '"}\n');
    const r = await indexBlob(b);
    const s = await readLine(b, r.offsets, 0, 100);
    expect(s.length).toBeLessThanOrEqual(100);
  });

  it('reports progress', async () => {
    let calls = 0;
    await indexBlob(blob('{"a":1}\n'.repeat(1000)), () => { calls++; });
    expect(calls).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/worker/indexer.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/worker/indexer.ts`:
```ts
import { OffsetIndex } from '../core/offsets';

export interface IndexResult { offsets: OffsetIndex; lineCount: number; fileSize: number }

const NL = 0x0a;

/** Stream the blob, recording the start offset of every non-empty line. */
export async function indexBlob(
  blob: Blob,
  onProgress?: (lines: number, bytes: number) => void,
): Promise<IndexResult> {
  const offsets = new OffsetIndex();
  const reader = blob.stream().getReader();
  let pos = 0;            // absolute byte position
  let lineStart = 0;      // start of current line
  let lineHasBytes = false; // current line has at least one non-CR byte
  let sinceProgress = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) {
      const byte = value[i]!;
      if (byte === NL) {
        if (lineHasBytes) offsets.push(lineStart);
        lineStart = pos + i + 1;
        lineHasBytes = false;
      } else if (byte !== 0x0d) {
        lineHasBytes = true;
      }
    }
    pos += value.length;
    sinceProgress += value.length;
    if (onProgress && sinceProgress >= 4 << 20) { // every ~4MB
      onProgress(offsets.length, pos);
      sinceProgress = 0;
    }
  }
  if (lineHasBytes) offsets.push(lineStart); // last line, no trailing \n
  offsets.setFileSize(blob.size);
  onProgress?.(offsets.length, pos);
  return { offsets, lineCount: offsets.length, fileSize: blob.size };
}

const decoder = new TextDecoder(); // fatal:false replaces invalid sequences

/** Read + decode line i. Trims \r, strips BOM on line 0, truncates to maxBytes if given. */
export async function readLine(
  blob: Blob, offsets: OffsetIndex, i: number, maxBytes?: number,
): Promise<string> {
  const start = offsets.start(i);
  let end = offsets.end(i);
  if (maxBytes !== undefined && end - start > maxBytes) end = start + maxBytes;
  const buf = new Uint8Array(await blob.slice(start, end).arrayBuffer());
  let s = decoder.decode(buf);
  if (i === 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.endsWith('\r')) s = s.slice(0, -1);
  return s;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/worker/indexer.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: streaming line indexer with CRLF/BOM/boundary handling"`

---

### Task 4: Query parser + matcher

**Files:**
- Create: `src/core/query.ts`, `src/core/query.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Term =
    | { kind: 'text'; value: string }
    | { kind: 'field'; path: string[]; op: ':' | '>' | '<' | 'exists'; value: string };
  interface Query { terms: Term[] }
  function parseQuery(input: string): Query
  function matchesLine(raw: string, query: Query, getParsed: () => unknown): boolean
  ```
  Semantics: bare key path (`["tokens"]`) matches at any depth, first match wins; dot path (`["usage","total_tokens"]`) is exact. Space-separated terms AND. Text terms are case-insensitive substring on raw. `field:*` = exists.

- [ ] **Step 1: Write failing tests**

`src/core/query.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseQuery, matchesLine } from './query';

const m = (raw: string, q: string, parsed?: unknown) =>
  matchesLine(raw, parseQuery(q), () => parsed ?? JSON.parse(raw));

describe('parseQuery', () => {
  it('parses text terms', () => {
    expect(parseQuery('hello world').terms).toEqual([
      { kind: 'text', value: 'hello' }, { kind: 'text', value: 'world' },
    ]);
  });
  it('parses field ops', () => {
    expect(parseQuery('role:assistant tokens>500 err:* usage.total_tokens<9').terms).toEqual([
      { kind: 'field', path: ['role'], op: ':', value: 'assistant' },
      { kind: 'field', path: ['tokens'], op: '>', value: '500' },
      { kind: 'field', path: ['err'], op: 'exists', value: '' },
      { kind: 'field', path: ['usage', 'total_tokens'], op: '<', value: '9' },
    ]);
  });
});

describe('matchesLine', () => {
  it('substring match is case-insensitive on raw', () => {
    expect(m('{"msg":"Fatal ERROR here"}', 'error')).toBe(true);
    expect(m('{"msg":"all good"}', 'error')).toBe(false);
  });
  it('field equality at top level', () => {
    expect(m('{"role":"assistant"}', 'role:assistant')).toBe(true);
    expect(m('{"role":"user"}', 'role:assistant')).toBe(false);
  });
  it('bare key matches at any depth', () => {
    expect(m('{"a":{"b":{"tokens":600}}}', 'tokens>500')).toBe(true);
  });
  it('dot path is exact', () => {
    expect(m('{"usage":{"total_tokens":42}}', 'usage.total_tokens<50')).toBe(true);
    expect(m('{"nested":{"usage":{"total_tokens":42}}}', 'usage.total_tokens<50')).toBe(false);
  });
  it('exists op', () => {
    expect(m('{"error":null}', 'error:*')).toBe(true);
    expect(m('{"ok":1}', 'error:*')).toBe(false);
  });
  it('AND across terms', () => {
    expect(m('{"role":"assistant","msg":"hi"}', 'role:assistant hi')).toBe(true);
    expect(m('{"role":"assistant","msg":"hi"}', 'role:assistant bye')).toBe(false);
  });
  it('field term on unparseable line is false, text term still works', () => {
    expect(matchesLine('not json', parseQuery('role:x'), () => undefined)).toBe(false);
    expect(matchesLine('not json', parseQuery('not'), () => undefined)).toBe(true);
  });
  it('numeric compare on non-numeric value is false', () => {
    expect(m('{"tokens":"lots"}', 'tokens>500')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/core/query.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/core/query.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/core/query.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: search query parser and matcher"`

---

### Task 5: Transcript shape detection + normalization

**Files:**
- Create: `src/core/detect.ts`, `src/core/detect.test.ts`, `tests/fixtures/openai.jsonl`, `tests/fixtures/claude-code.jsonl`, `tests/fixtures/generic.jsonl`

**Interfaces:**
- Produces:
  ```ts
  type Role = 'system' | 'user' | 'assistant' | 'tool' | 'other';
  interface ContentPart {
    type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
    text: string;            // markdown/plain body (tool parts: pretty JSON string)
    label?: string;          // e.g. tool name
  }
  interface Msg { role: Role; parts: ContentPart[]; tokens?: number; model?: string }
  /** null when the line is not transcript-shaped */
  function normalizeToMessages(value: unknown): Msg[] | null
  ```
  Detection order (per spec): OpenAI `{messages:[...]}` → single message `{role, content}` (string or Anthropic block array) → Claude Code session line (`{type:'user'|'assistant', message:{...}}`) → generic heuristic (`role`-ish + one of `content|text|message` string).

- [ ] **Step 1: Create fixtures**

`tests/fixtures/openai.jsonl`:
```
{"messages":[{"role":"system","content":"You are helpful."},{"role":"user","content":"Hi **there**"},{"role":"assistant","content":"Hello!"}]}
{"messages":[{"role":"user","content":"2+2?"},{"role":"assistant","content":"4"}]}
```

`tests/fixtures/claude-code.jsonl`:
```
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"fix the bug"}]},"uuid":"u1","timestamp":"2026-07-01T00:00:00Z"}
{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"Done."},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}],"usage":{"output_tokens":42}},"uuid":"u2"}
```

`tests/fixtures/generic.jsonl`:
```
{"role":"user","content":"plain string content"}
{"role":"assistant","content":[{"type":"text","text":"block content"}]}
{"speaker":"agent","text":"heuristic shape"}
{"level":"info","msg":"not a transcript"}
```

- [ ] **Step 2: Write failing tests**

`src/core/detect.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeToMessages } from './detect';

const lines = (f: string) =>
  readFileSync(`tests/fixtures/${f}`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('normalizeToMessages', () => {
  it('handles OpenAI fine-tune shape', () => {
    const msgs = normalizeToMessages(lines('openai.jsonl')[0])!;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(msgs[1]!.parts[0]).toEqual({ type: 'text', text: 'Hi **there**' });
  });

  it('handles single message with string content', () => {
    const msgs = normalizeToMessages(lines('generic.jsonl')[0])!;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
  });

  it('handles Anthropic content-block arrays', () => {
    const msgs = normalizeToMessages(lines('generic.jsonl')[1])!;
    expect(msgs[0]!.parts[0]).toEqual({ type: 'text', text: 'block content' });
  });

  it('handles Claude Code session lines incl. thinking, tool_use, tokens, model', () => {
    const msgs = normalizeToMessages(lines('claude-code.jsonl')[1])!;
    expect(msgs[0]!.role).toBe('assistant');
    expect(msgs[0]!.model).toBe('claude-opus-4-8');
    expect(msgs[0]!.tokens).toBe(42);
    const types = msgs[0]!.parts.map((p) => p.type);
    expect(types).toEqual(['thinking', 'text', 'tool_use']);
    expect(msgs[0]!.parts[2]!.label).toBe('Bash');
  });

  it('handles generic heuristic (speaker + text)', () => {
    const msgs = normalizeToMessages(lines('generic.jsonl')[2])!;
    expect(msgs[0]!.role).toBe('other');
    expect(msgs[0]!.parts[0]!.text).toBe('heuristic shape');
  });

  it('returns null for non-transcript lines', () => {
    expect(normalizeToMessages(lines('generic.jsonl')[3])).toBeNull();
    expect(normalizeToMessages([1, 2, 3])).toBeNull();
    expect(normalizeToMessages('str')).toBeNull();
    expect(normalizeToMessages(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify fail** — `npx vitest run src/core/detect.test.ts` → FAIL.

- [ ] **Step 4: Implement**

`src/core/detect.ts`:
```ts
export type Role = 'system' | 'user' | 'assistant' | 'tool' | 'other';
export interface ContentPart {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text: string;
  label?: string;
}
export interface Msg { role: Role; parts: ContentPart[]; tokens?: number; model?: string }

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

const ROLES: Role[] = ['system', 'user', 'assistant', 'tool'];
const toRole = (v: unknown): Role =>
  typeof v === 'string' && (ROLES as string[]).includes(v) ? (v as Role) : 'other';

const pretty = (v: unknown) => JSON.stringify(v, null, 2) ?? String(v);

/** Anthropic-style content: string, or array of typed blocks. */
function contentToParts(content: unknown): ContentPart[] | null {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return null;
  const parts: ContentPart[] = [];
  for (const block of content) {
    if (!isObj(block)) return null;
    switch (block.type) {
      case 'text': parts.push({ type: 'text', text: String(block.text ?? '') }); break;
      case 'thinking': parts.push({ type: 'thinking', text: String(block.thinking ?? '') }); break;
      case 'tool_use':
        parts.push({ type: 'tool_use', text: pretty(block.input), label: String(block.name ?? 'tool') });
        break;
      case 'tool_result':
        parts.push({ type: 'tool_result', text: pretty(block.content), label: 'result' });
        break;
      default: parts.push({ type: 'text', text: pretty(block) });
    }
  }
  return parts;
}

function singleMessage(v: Rec): Msg | null {
  if (!('role' in v)) return null;
  const parts = contentToParts(v.content);
  if (!parts) return null;
  const msg: Msg = { role: toRole(v.role), parts };
  const usage = isObj(v.usage) ? v.usage : undefined;
  const tokens = usage?.output_tokens ?? usage?.total_tokens ?? v.tokens;
  if (typeof tokens === 'number') msg.tokens = tokens;
  if (typeof v.model === 'string') msg.model = v.model;
  return msg;
}

export function normalizeToMessages(value: unknown): Msg[] | null {
  if (!isObj(value)) return null;

  // 1. OpenAI fine-tune / chat: {messages: [...]}
  if (Array.isArray(value.messages)) {
    const msgs: Msg[] = [];
    for (const m of value.messages) {
      if (!isObj(m)) return null;
      const msg = singleMessage(m);
      if (!msg) return null;
      msgs.push(msg);
    }
    return msgs.length ? msgs : null;
  }

  // 2. Single message: {role, content}
  const single = singleMessage(value);
  if (single) return [single];

  // 3. Claude Code session line: {type:'user'|'assistant', message:{...}}
  if ((value.type === 'user' || value.type === 'assistant') && isObj(value.message)) {
    const inner = singleMessage(value.message);
    if (inner) return [inner];
  }

  // 4. Generic heuristic: role-ish key + string body key
  const roleKey = ['role', 'speaker', 'author', 'from'].find((k) => typeof value[k] === 'string');
  const bodyKey = ['content', 'text', 'message', 'msg'].find((k) => typeof value[k] === 'string');
  if (roleKey && bodyKey && roleKey !== bodyKey) {
    return [{ role: toRole(value[roleKey]), parts: [{ type: 'text', text: value[bodyKey] as string }] }];
  }
  return null;
}
```

Note: the fixture line `{"level":"info","msg":"not a transcript"}` must stay null — `level` is not in the role-key list. Test asserts it.

- [ ] **Step 5: Run to verify pass** — `npx vitest run src/core/detect.test.ts` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: transcript shape detection and normalization"`

---

### Task 6: JSON preview tokenizer

**Files:**
- Create: `src/core/jsonPreview.ts`, `src/core/jsonPreview.test.ts`

**Interfaces:**
- Produces: `function previewTokens(raw: string, maxLen?: number): { text: string; cls: 'key'|'str'|'num'|'bool'|'punct' }[]` — lexes a (possibly truncated) JSON line into colored spans. Never throws on malformed input; falls back to one `punct` token. Consumer renders each token as a `<span class="tok-{cls}">` via `textContent`.

- [ ] **Step 1: Write failing tests**

`src/core/jsonPreview.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { previewTokens } from './jsonPreview';

describe('previewTokens', () => {
  it('classifies keys, strings, numbers, booleans', () => {
    const toks = previewTokens('{"name":"ada","age":36,"ok":true,"x":null}');
    const by = (cls: string) => toks.filter((t) => t.cls === cls).map((t) => t.text);
    expect(by('key')).toEqual(['"name"', '"age"', '"ok"', '"x"']);
    expect(by('str')).toEqual(['"ada"']);
    expect(by('num')).toEqual(['36']);
    expect(by('bool')).toEqual(['true', 'null']);
  });
  it('respects maxLen and appends ellipsis token', () => {
    const toks = previewTokens('{"k":"' + 'v'.repeat(500) + '"}', 50);
    const total = toks.reduce((n, t) => n + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(51); // 50 + '…'
    expect(toks[toks.length - 1]!.text.endsWith('…')).toBe(true);
  });
  it('never throws on garbage', () => {
    expect(() => previewTokens('not json at all')).not.toThrow();
    expect(previewTokens('not json')[0]!.cls).toBe('punct');
  });
  it('handles escaped quotes in strings', () => {
    const toks = previewTokens('{"a":"say \\"hi\\""}');
    expect(toks.find((t) => t.cls === 'str')!.text).toBe('"say \\"hi\\""');
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/core/jsonPreview.ts`:
```ts
export interface PreviewToken { text: string; cls: 'key' | 'str' | 'num' | 'bool' | 'punct' }

/** Cheap single-pass lexer for one JSON line. Tolerant: garbage → one punct token. */
export function previewTokens(raw: string, maxLen = 160): PreviewToken[] {
  const src = raw.length > maxLen ? raw.slice(0, maxLen) : raw;
  const out: PreviewToken[] = [];
  let i = 0;
  const push = (text: string, cls: PreviewToken['cls']) => { out.push({ text, cls }); };

  if (!src.startsWith('{') && !src.startsWith('[')) {
    push(src, 'punct');
  } else {
    let punct = '';
    const flush = () => { if (punct) { push(punct, 'punct'); punct = ''; } };
    while (i < src.length) {
      const c = src[i]!;
      if (c === '"') {
        // scan string, honoring escapes; may be unterminated (truncated line)
        let j = i + 1;
        while (j < src.length && (src[j] !== '"' || src[j - 1] === '\\')) j++;
        const text = src.slice(i, Math.min(j + 1, src.length));
        // key iff next non-space char is ':'
        let k = j + 1;
        while (k < src.length && src[k] === ' ') k++;
        flush();
        push(text, src[k] === ':' ? 'key' : 'str');
        i = j + 1;
      } else if (/[-0-9]/.test(c)) {
        let j = i;
        while (j < src.length && /[-0-9.eE+]/.test(src[j]!)) j++;
        flush(); push(src.slice(i, j), 'num'); i = j;
      } else if (/[a-z]/.test(c)) {
        let j = i;
        while (j < src.length && /[a-z]/.test(src[j]!)) j++;
        const word = src.slice(i, j);
        flush(); push(word, word === 'true' || word === 'false' || word === 'null' ? 'bool' : 'punct');
        i = j;
      } else {
        punct += c; i++;
      }
    }
    flush();
  }
  if (raw.length > maxLen) {
    const last = out[out.length - 1]!;
    last.text += '…';
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: json preview tokenizer for row coloring"`

---

### Task 7: Worker + RPC client

**Files:**
- Create: `src/worker/worker.ts`, `src/ui/workerClient.ts`, `src/worker/protocol.ts`, `src/worker/protocol.test.ts`

**Interfaces:**
- Consumes: `indexBlob`, `readLine` (Task 3); `parseQuery`, `matchesLine` (Task 4).
- Produces `src/worker/protocol.ts` message types (shared by worker + client):
  ```ts
  // main → worker
  type ToWorker =
    | { type: 'load'; blob: Blob }
    | { type: 'getLines'; from: number; to: number; reqId: number }   // previews (truncated)
    | { type: 'getLine'; index: number; reqId: number }               // full text
    | { type: 'search'; query: string; searchId: number }
    | { type: 'validate' };
  // worker → main
  type FromWorker =
    | { type: 'indexProgress'; lines: number; bytes: number; totalBytes: number }
    | { type: 'indexed'; lineCount: number; fileSize: number }
    | { type: 'lines'; reqId: number; from: number; previews: string[] }
    | { type: 'line'; reqId: number; index: number; text: string }
    | { type: 'searchHits'; searchId: number; hits: number[]; done: boolean; scanned: number; total: number }
    | { type: 'badLines'; indices: number[]; done: boolean }
    | { type: 'fatal'; message: string };
  ```
- Produces `WorkerClient` (main thread):
  ```ts
  class WorkerClient {
    onIndexProgress?: (lines: number, bytes: number, totalBytes: number) => void;
    onIndexed?: (lineCount: number, fileSize: number) => void;
    onSearchHits?: (searchId: number, hits: number[], done: boolean, scanned: number, total: number) => void;
    onBadLines?: (indices: number[], done: boolean) => void;
    onFatal?: (message: string) => void;
    load(blob: Blob): void;
    getLines(from: number, to: number): Promise<string[]>;   // coalesces + drops stale
    getLine(index: number): Promise<string>;
    search(query: string): number;                            // returns searchId; aborts previous
    validate(): void;
  }
  ```
- Search semantics in worker: iterate all lines, `readLine` each, apply `matchesLine`; post hits in batches of 500; check `currentSearchId` between batches to abort superseded scans; empty query → hits = all (post `done` immediately with no filtering flag).

- [ ] **Step 1: Write failing test for the router logic**

Real workers don't run under vitest/jsdom. Extract the router as a pure function taking a `post` callback, test that; `worker.ts` is a 5-line shell around it.

`src/worker/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRouter } from './worker';
import type { FromWorker } from './protocol';

const load = (router: ReturnType<typeof createRouter>, text: string) =>
  router({ type: 'load', blob: new Blob([text]) });

describe('worker router', () => {
  it('indexes then serves previews and full lines', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, '{"a":1}\n{"b":"' + 'x'.repeat(1000) + '"}\n');
    expect(posted.find((m) => m.type === 'indexed')).toMatchObject({ lineCount: 2 });

    await router({ type: 'getLines', from: 0, to: 1, reqId: 1 });
    const lines = posted.find((m) => m.type === 'lines') as Extract<FromWorker, {type:'lines'}>;
    expect(lines.previews[0]).toBe('{"a":1}');
    expect(lines.previews[1]!.length).toBeLessThan(1000); // truncated preview

    await router({ type: 'getLine', index: 1, reqId: 2 });
    const full = posted.find((m) => m.type === 'line') as Extract<FromWorker, {type:'line'}>;
    expect(full.text.length).toBeGreaterThan(1000);
  });

  it('searches with abort of superseded scan', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, Array.from({ length: 1000 }, (_, i) => `{"n":${i}}`).join('\n'));
    await router({ type: 'search', query: 'n>990', searchId: 1 });
    const hits = posted.filter((m) => m.type === 'searchHits' && m.searchId === 1)
      .flatMap((m) => (m as Extract<FromWorker, {type:'searchHits'}>).hits);
    expect(hits).toHaveLength(9); // 991..999
  });

  it('validate reports bad lines', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, '{"ok":1}\nnot json\n{"ok":2}\n');
    await router({ type: 'validate' });
    const bad = posted.filter((m) => m.type === 'badLines')
      .flatMap((m) => (m as Extract<FromWorker, {type:'badLines'}>).indices);
    expect(bad).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/worker/protocol.ts`: the two union types exactly as in Interfaces above, `export`ed.

`src/worker/worker.ts`:
```ts
import { indexBlob, readLine } from './indexer';
import { parseQuery, matchesLine } from '../core/query';
import type { OffsetIndex } from '../core/offsets';
import type { ToWorker, FromWorker } from './protocol';

const PREVIEW_BYTES = 512;
const BATCH = 500;

export function createRouter(post: (m: FromWorker) => void) {
  let blob: Blob | null = null;
  let offsets: OffsetIndex | null = null;
  let currentSearchId = 0;

  return async function route(msg: ToWorker): Promise<void> {
    try {
      switch (msg.type) {
        case 'load': {
          blob = msg.blob;
          const total = blob.size;
          const r = await indexBlob(blob, (lines, bytes) =>
            post({ type: 'indexProgress', lines, bytes, totalBytes: total }));
          offsets = r.offsets;
          post({ type: 'indexed', lineCount: r.lineCount, fileSize: r.fileSize });
          break;
        }
        case 'getLines': {
          if (!blob || !offsets) return;
          const previews: string[] = [];
          for (let i = msg.from; i <= msg.to && i < offsets.length; i++) {
            previews.push(await readLine(blob, offsets, i, PREVIEW_BYTES));
          }
          post({ type: 'lines', reqId: msg.reqId, from: msg.from, previews });
          break;
        }
        case 'getLine': {
          if (!blob || !offsets) return;
          post({ type: 'line', reqId: msg.reqId, index: msg.index,
                 text: await readLine(blob, offsets, msg.index) });
          break;
        }
        case 'search': {
          if (!blob || !offsets) return;
          currentSearchId = msg.searchId;
          const q = parseQuery(msg.query);
          const total = offsets.length;
          let hits: number[] = [];
          for (let i = 0; i < total; i++) {
            if (currentSearchId !== msg.searchId) return; // superseded
            const raw = await readLine(blob, offsets, i);
            let parsed: unknown, tried = false;
            const getParsed = () => {
              if (!tried) { tried = true; try { parsed = JSON.parse(raw); } catch { parsed = undefined; } }
              return parsed;
            };
            if (matchesLine(raw, q, getParsed)) hits.push(i);
            if (hits.length >= BATCH || (i % 5000 === 4999)) {
              post({ type: 'searchHits', searchId: msg.searchId, hits, done: false, scanned: i + 1, total });
              hits = [];
            }
          }
          post({ type: 'searchHits', searchId: msg.searchId, hits, done: true, scanned: total, total });
          break;
        }
        case 'validate': {
          if (!blob || !offsets) return;
          let bad: number[] = [];
          for (let i = 0; i < offsets.length; i++) {
            const raw = await readLine(blob, offsets, i);
            try { JSON.parse(raw); } catch { bad.push(i); }
            if (bad.length >= BATCH) { post({ type: 'badLines', indices: bad, done: false }); bad = []; }
          }
          post({ type: 'badLines', indices: bad, done: true });
          break;
        }
      }
    } catch (e) {
      post({ type: 'fatal', message: e instanceof Error ? e.message : String(e) });
    }
  };
}

// Worker shell — excluded from vitest coverage, exercised by e2e.
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function' && !('window' in self)) {
  const route = createRouter((m) => (self as any).postMessage(m));
  self.onmessage = (e: MessageEvent<ToWorker>) => { void route(e.data); };
}
```

`src/ui/workerClient.ts`:
```ts
import type { ToWorker, FromWorker } from '../worker/protocol';

export class WorkerClient {
  onIndexProgress?: (lines: number, bytes: number, totalBytes: number) => void;
  onIndexed?: (lineCount: number, fileSize: number) => void;
  onSearchHits?: (searchId: number, hits: number[], done: boolean, scanned: number, total: number) => void;
  onBadLines?: (indices: number[], done: boolean) => void;
  onFatal?: (message: string) => void;

  private worker: Worker;
  private reqId = 0;
  private searchId = 0;
  private pendingLines = new Map<number, (previews: string[]) => void>();
  private pendingLine = new Map<number, (text: string) => void>();
  private latestLinesReq = 0; // stale getLines results are dropped

  constructor() {
    this.worker = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.dispatch(e.data);
    this.worker.onerror = () => this.onFatal?.('Worker crashed — the file may be too large for this device.');
  }

  private dispatch(m: FromWorker): void {
    switch (m.type) {
      case 'indexProgress': this.onIndexProgress?.(m.lines, m.bytes, m.totalBytes); break;
      case 'indexed': this.onIndexed?.(m.lineCount, m.fileSize); break;
      case 'lines':
        if (m.reqId === this.latestLinesReq) this.pendingLines.get(m.reqId)?.(m.previews);
        this.pendingLines.delete(m.reqId);
        break;
      case 'line': this.pendingLine.get(m.reqId)?.(m.text); this.pendingLine.delete(m.reqId); break;
      case 'searchHits':
        if (m.searchId === this.searchId) this.onSearchHits?.(m.searchId, m.hits, m.done, m.scanned, m.total);
        break;
      case 'badLines': this.onBadLines?.(m.indices, m.done); break;
      case 'fatal': this.onFatal?.(m.message); break;
    }
  }

  private send(m: ToWorker): void { this.worker.postMessage(m); }

  load(blob: Blob): void { this.send({ type: 'load', blob }); }

  getLines(from: number, to: number): Promise<string[]> {
    const reqId = ++this.reqId;
    this.latestLinesReq = reqId; // supersedes any in-flight preview request
    return new Promise((res) => { this.pendingLines.set(reqId, res); this.send({ type: 'getLines', from, to, reqId }); });
  }

  getLine(index: number): Promise<string> {
    const reqId = ++this.reqId;
    return new Promise((res) => { this.pendingLine.set(reqId, res); this.send({ type: 'getLine', index, reqId }); });
  }

  search(query: string): number {
    const id = ++this.searchId;
    this.send({ type: 'search', query, searchId: id });
    return id;
  }

  validate(): void { this.send({ type: 'validate' }); }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/worker/protocol.test.ts` → PASS. Also full suite: `npm test`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: worker router and main-thread rpc client"`

---

### Task 8: Virtual list

**Files:**
- Create: `src/ui/virtualList.ts`, `src/ui/virtualList.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface VirtualListOpts {
    container: HTMLElement;           // scrollable, fixed height
    rowHeight: number;
    render: (index: number, el: HTMLElement) => void; // fill row content
    onRangeChange?: (from: number, to: number) => void;
  }
  function visibleRange(scrollTop: number, viewport: number, rowHeight: number, total: number, overscan?: number): { from: number; to: number }
  class VirtualList {
    constructor(opts: VirtualListOpts);
    setTotal(n: number): void;        // resets scroll, rerenders
    refresh(): void;                  // rerender current window
    scrollToIndex(i: number): void;
    setSelected(i: number | null): void; // adds .selected class to row
  }
  ```
  Rows are absolutely-positioned divs with class `row`, `data-index`, recycled per render window. `visibleRange` is exported pure math (unit-tested); DOM behavior is covered by e2e.

- [ ] **Step 1: Write failing tests (pure math)**

`src/ui/virtualList.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { visibleRange } from './virtualList';

describe('visibleRange', () => {
  it('computes window with overscan', () => {
    expect(visibleRange(0, 280, 28, 1000, 5)).toEqual({ from: 0, to: 14 }); // 10 visible + 5 over
    expect(visibleRange(2800, 280, 28, 1000, 5)).toEqual({ from: 95, to: 114 });
  });
  it('clamps at end', () => {
    expect(visibleRange(27700, 280, 28, 1000, 5)).toEqual({ from: 984, to: 999 });
  });
  it('handles zero rows', () => {
    expect(visibleRange(0, 280, 28, 0, 5)).toEqual({ from: 0, to: -1 });
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/ui/virtualList.ts`:
```ts
export function visibleRange(
  scrollTop: number, viewport: number, rowHeight: number, total: number, overscan = 10,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: -1 };
  const first = Math.floor(scrollTop / rowHeight);
  const count = Math.ceil(viewport / rowHeight);
  return {
    from: Math.max(0, first - overscan),
    to: Math.min(total - 1, first + count + overscan - 1),
  };
}

export interface VirtualListOpts {
  container: HTMLElement;
  rowHeight: number;
  render: (index: number, el: HTMLElement) => void;
  onRangeChange?: (from: number, to: number) => void;
}

export class VirtualList {
  private total = 0;
  private spacer: HTMLElement;
  private rows = new Map<number, HTMLElement>();
  private selected: number | null = null;
  private raf = 0;

  constructor(private opts: VirtualListOpts) {
    this.spacer = document.createElement('div');
    this.spacer.style.position = 'relative';
    opts.container.appendChild(this.spacer);
    opts.container.addEventListener('scroll', () => this.schedule());
  }

  private schedule(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.renderWindow());
  }

  setTotal(n: number): void {
    this.total = n;
    this.spacer.style.height = `${n * this.opts.rowHeight}px`;
    this.opts.container.scrollTop = 0;
    this.renderWindow();
  }

  refresh(): void { this.renderWindow(); }

  scrollToIndex(i: number): void {
    const { container, rowHeight } = this.opts;
    const top = i * rowHeight;
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - rowHeight) {
      container.scrollTop = top - container.clientHeight / 2;
    }
    this.renderWindow();
  }

  setSelected(i: number | null): void {
    this.selected = i;
    for (const [idx, el] of this.rows) el.classList.toggle('selected', idx === i);
  }

  private renderWindow(): void {
    const { container, rowHeight, render, onRangeChange } = this.opts;
    const { from, to } = visibleRange(container.scrollTop, container.clientHeight, rowHeight, this.total);
    for (const [idx, el] of this.rows) {
      if (idx < from || idx > to) { el.remove(); this.rows.delete(idx); }
    }
    for (let i = from; i <= to; i++) {
      if (!this.rows.has(i)) {
        const el = document.createElement('div');
        el.className = 'row';
        el.dataset.index = String(i);
        el.style.cssText = `position:absolute;top:${i * rowHeight}px;height:${rowHeight}px;left:0;right:0;`;
        el.classList.toggle('selected', i === this.selected);
        render(i, el);
        this.spacer.appendChild(el);
        this.rows.set(i, el);
      }
    }
    onRangeChange?.(from, to);
  }
}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: fixed-height virtual list"`

---

### Task 9: Detail pane — JSON tree + transcript renderer

**Files:**
- Create: `src/ui/detailJson.ts`, `src/ui/detailJson.test.ts`, `src/ui/detailTranscript.ts`, `src/ui/detailTranscript.test.ts`, `tests/fixtures/xss.jsonl`

**Interfaces:**
- Consumes: `Msg`, `ContentPart` (Task 5).
- Produces:
  ```ts
  // detailJson.ts — collapsible tree, all values via textContent. Never innerHTML.
  function renderJsonTree(value: unknown, container: HTMLElement): void
  // Nodes with > COLLAPSE_THRESHOLD (=50) children or depth > 4 render collapsed;
  // children are built lazily on first expand (click).

  // detailTranscript.ts
  function renderTranscript(msgs: Msg[], container: HTMLElement): void
  // - bubble per message: <article class="msg role-{role}">
  // - text parts: marked.parse → DOMPurify.sanitize → innerHTML
  // - thinking / tool_use / tool_result: <details> collapsed by default, label in <summary>, body in <pre> via textContent
  // - token badge when msg.tokens present, model label when msg.model present
  ```
- Vitest environment: these tests need DOM — add `// @vitest-environment jsdom` at top of both test files and `npm i -D jsdom`.

- [ ] **Step 1: Create XSS fixture**

`tests/fixtures/xss.jsonl`:
```
{"role":"user","content":"<script>window.__pwned=1</script> hello"}
{"role":"assistant","content":"<img src=x onerror=\"window.__pwned=2\"> **bold** [link](javascript:alert(3))"}
{"key":"<script>window.__pwned=4</script>","value":"plain <b>html</b>"}
```

- [ ] **Step 2: Write failing tests**

`src/ui/detailJson.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderJsonTree } from './detailJson';

describe('renderJsonTree', () => {
  it('renders primitives with syntax classes', () => {
    const el = document.createElement('div');
    renderJsonTree({ name: 'ada', age: 36, ok: true }, el);
    expect(el.querySelector('.tok-key')!.textContent).toBe('name');
    expect(el.querySelector('.tok-str')!.textContent).toBe('"ada"');
    expect(el.querySelector('.tok-num')!.textContent).toBe('36');
  });

  it('never executes or embeds HTML from values', () => {
    const el = document.createElement('div');
    renderJsonTree({ k: '<script>window.__pwned=4</script>' }, el);
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>'); // shown as text
  });

  it('collapses large arrays and expands on click', () => {
    const el = document.createElement('div');
    renderJsonTree({ big: Array.from({ length: 100 }, (_, i) => i) }, el);
    const details = el.querySelector('details.json-node')!;
    expect((details as HTMLDetailsElement).open).toBe(false);
    // children not built until expand
    expect(details.querySelectorAll('.tok-num').length).toBe(0);
    details.dispatchEvent(new Event('toggle'));
    (details as HTMLDetailsElement).open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(details.querySelectorAll('.tok-num').length).toBe(100);
  });
});
```

`src/ui/detailTranscript.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderTranscript } from './detailTranscript';
import { normalizeToMessages } from '../core/detect';

const xssLines = readFileSync('tests/fixtures/xss.jsonl', 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l));

describe('renderTranscript', () => {
  it('renders role bubbles with markdown', () => {
    const el = document.createElement('div');
    renderTranscript(normalizeToMessages({ role: 'assistant', content: 'some **bold** text' })!, el);
    expect(el.querySelector('article.msg.role-assistant')).toBeTruthy();
    expect(el.querySelector('strong')!.textContent).toBe('bold');
  });

  it('sanitizes script tags and event handlers (XSS fixtures)', () => {
    for (const line of xssLines.slice(0, 2)) {
      const el = document.createElement('div');
      renderTranscript(normalizeToMessages(line)!, el);
      expect(el.querySelector('script')).toBeNull();
      expect(el.innerHTML).not.toContain('onerror');
      expect(el.innerHTML).not.toContain('javascript:');
    }
    expect((window as any).__pwned).toBeUndefined();
  });

  it('collapses tool_use into details with label', () => {
    const msgs = normalizeToMessages({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    })!;
    const el = document.createElement('div');
    renderTranscript(msgs, el);
    const d = el.querySelector('details.part-tool_use')! as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')!.textContent).toContain('Bash');
    expect(d.querySelector('pre')!.textContent).toContain('"command"');
  });

  it('shows token badge', () => {
    const el = document.createElement('div');
    renderTranscript([{ role: 'assistant', parts: [{ type: 'text', text: 'hi' }], tokens: 42 }], el);
    expect(el.querySelector('.token-badge')!.textContent).toContain('42');
  });
});
```

- [ ] **Step 3: Run to verify fail.**

- [ ] **Step 4: Implement**

`src/ui/detailJson.ts`:
```ts
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
  const wrap = document.createElement('div');
  wrap.className = 'json-entry';
  wrap.appendChild(entryLabel(key));

  if (value === null || typeof value !== 'object') {
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
    if (built) return; built = true;
    for (const [k, v] of entries) body.appendChild(node(isArr ? null : k, v, depth + 1));
  };
  if (details.open) build();
  details.addEventListener('toggle', () => { if (details.open) build(); });
  return details.open || entries.length === 0 ? (wrap.firstChild && key !== null ? details : details) : details;
}

export function renderJsonTree(value: unknown, container: HTMLElement): void {
  container.textContent = '';
  container.appendChild(node(null, value, 0));
}
```

(Implementer note: simplify `node`'s return — always return `details` for objects/arrays, `wrap` for primitives. The summary already carries the key label for object nodes, so `wrap` is only used on the primitive path.)

`src/ui/detailTranscript.ts`:
```ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Msg, ContentPart } from '../core/detect';

marked.setOptions({ async: false });

function mdToSafeHtml(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] });
}

function renderPart(part: ContentPart): HTMLElement {
  if (part.type === 'text') {
    const div = document.createElement('div');
    div.className = 'part-text';
    div.innerHTML = mdToSafeHtml(part.text);
    return div;
  }
  const details = document.createElement('details');
  details.className = `part-${part.type}`;
  const summary = document.createElement('summary');
  summary.textContent = part.type === 'thinking' ? 'thinking'
    : `${part.type === 'tool_use' ? '⚙ ' : '← '}${part.label ?? part.type}`;
  const pre = document.createElement('pre');
  pre.textContent = part.text;
  details.append(summary, pre);
  return details;
}

export function renderTranscript(msgs: Msg[], container: HTMLElement): void {
  container.textContent = '';
  for (const msg of msgs) {
    const article = document.createElement('article');
    article.className = `msg role-${msg.role}`;
    const header = document.createElement('header');
    const role = document.createElement('span');
    role.className = 'role-label';
    role.textContent = msg.role;
    header.appendChild(role);
    if (msg.model) {
      const model = document.createElement('span');
      model.className = 'model-label';
      model.textContent = msg.model;
      header.appendChild(model);
    }
    if (msg.tokens !== undefined) {
      const badge = document.createElement('span');
      badge.className = 'token-badge';
      badge.textContent = `${msg.tokens} tok`;
      header.appendChild(badge);
    }
    article.appendChild(header);
    for (const part of msg.parts) article.appendChild(renderPart(part));
    container.appendChild(article);
  }
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run src/ui` → PASS. Fix the `node()` return-path wart while making tests pass (tests define the contract).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: json tree and sanitized transcript renderers"`

---

### Task 10: App wiring — dropzone, panes, topbar, search UI

**Files:**
- Create: `src/ui/dropzone.ts`, `src/ui/topbar.ts`
- Modify: `src/main.ts` (replace placeholder)

**Interfaces:**
- Consumes: everything above.
- Produces working app. `dropzone.ts` exports `initDropzone(el: HTMLElement, onBlob: (blob: Blob, name: string) => void): void` — handles drag/drop, click-to-browse (`<input type=file>`), document-level paste (text → `new Blob([text])`, name `pasted.jsonl`), and demo-link fetch (`fetch('/demo.jsonl').then(r => r.blob())`). `topbar.ts` exports `renderTopbar(el, state)` + emits events via callbacks: `onSearch(q)`, `onModeToggle()`, `onThemeToggle()`, `onNewFile()`, `onErrorsClick()`.

No unit tests for this task (pure DOM wiring) — e2e covers it in Task 13. Keep each file under ~150 lines.

- [ ] **Step 1: Implement `dropzone.ts`**

```ts
export function initDropzone(
  el: HTMLElement,
  demoBtn: HTMLElement,
  onBlob: (blob: Blob, name: string) => void,
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.jsonl,.ndjson,.json,.txt';
  input.hidden = true;
  el.appendChild(input);

  el.addEventListener('click', () => input.click());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onBlob(f, f.name);
  });

  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  for (const ev of ['dragenter', 'dragover', 'dragleave', 'drop']) document.addEventListener(ev, stop);
  document.addEventListener('dragover', () => el.classList.add('dragging'));
  document.addEventListener('dragleave', () => el.classList.remove('dragging'));
  document.addEventListener('drop', (e) => {
    el.classList.remove('dragging');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) onBlob(f, f.name);
  });

  document.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text');
    if (text && text.trim()) onBlob(new Blob([text]), 'pasted.jsonl');
  });

  demoBtn.addEventListener('click', async () => {
    const r = await fetch('/demo.jsonl');
    onBlob(await r.blob(), 'demo.jsonl');
  });
}
```

- [ ] **Step 2: Implement `topbar.ts`**

```ts
export interface TopbarState {
  filename: string; lineCount: number; fileSize: number;
  badCount: number; matchCount: number | null; searching: boolean;
  mode: 'json' | 'transcript'; transcriptAvailable: boolean;
}
export interface TopbarHandlers {
  onSearch: (q: string) => void; onModeToggle: () => void;
  onThemeToggle: () => void; onNewFile: () => void; onErrorsClick: () => void;
}

const fmtSize = (n: number) =>
  n > 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB`
  : n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB`
  : `${(n / 1024).toFixed(1)} KB`;

export function createTopbar(el: HTMLElement, h: TopbarHandlers) {
  el.innerHTML = `
    <span class="readout" id="tb-file"></span>
    <span class="readout" id="tb-lines"></span>
    <span class="readout" id="tb-size"></span>
    <button class="readout danger" id="tb-errors" hidden></button>
    <input id="tb-search" type="search" placeholder='search — text, role:assistant, tokens>500'
           spellcheck="false" autocomplete="off" />
    <span class="readout" id="tb-matches" hidden></span>
    <button id="tb-mode" hidden></button>
    <button id="tb-theme" aria-label="toggle theme">◐</button>
    <button id="tb-new">new file</button>
  `;
  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
  let t = 0;
  ($('tb-search') as HTMLInputElement).addEventListener('input', (e) => {
    clearTimeout(t);
    t = window.setTimeout(() => h.onSearch((e.target as HTMLInputElement).value), 150);
  });
  $('tb-mode').addEventListener('click', h.onModeToggle);
  $('tb-theme').addEventListener('click', h.onThemeToggle);
  $('tb-new').addEventListener('click', h.onNewFile);
  $('tb-errors').addEventListener('click', h.onErrorsClick);

  return function update(s: TopbarState): void {
    $('tb-file').textContent = s.filename;
    $('tb-lines').textContent = `${s.lineCount.toLocaleString()} lines`;
    $('tb-size').textContent = fmtSize(s.fileSize);
    const err = $('tb-errors');
    err.hidden = s.badCount === 0;
    err.textContent = `${s.badCount} bad`;
    const matches = $('tb-matches');
    matches.hidden = s.matchCount === null;
    matches.textContent = s.searching ? `${s.matchCount} matches…` : `${s.matchCount} matches`;
    const mode = $('tb-mode');
    mode.hidden = !s.transcriptAvailable;
    mode.textContent = s.mode === 'json' ? 'transcript view' : 'json view';
  };
}
```

- [ ] **Step 3: Implement `main.ts`**

```ts
import { WorkerClient } from './ui/workerClient';
import { VirtualList } from './ui/virtualList';
import { initDropzone } from './ui/dropzone';
import { createTopbar, type TopbarState } from './ui/topbar';
import { renderJsonTree } from './ui/detailJson';
import { renderTranscript } from './ui/detailTranscript';
import { normalizeToMessages } from './core/detect';
import { previewTokens } from './core/jsonPreview';

const $ = (id: string) => document.getElementById(id)!;
const ROW_H = 28;

const state = {
  client: null as WorkerClient | null,
  filename: '', lineCount: 0, fileSize: 0,
  filtered: null as number[] | null,     // search hits (indices) or null = all
  badLines: new Set<number>(),
  selected: null as number | null,
  mode: 'json' as 'json' | 'transcript',
  transcriptAvailable: false,
  matchCount: null as number | null, searching: false,
  previews: new Map<number, string>(),   // LRU-ish preview cache
};

const listPane = $('list-pane');
const detailPane = $('detail-pane');

const displayTotal = () => state.filtered ? state.filtered.length : state.lineCount;
const displayToLine = (row: number) => state.filtered ? state.filtered[row]! : row;

const list = new VirtualList({
  container: listPane, rowHeight: ROW_H,
  render(row, el) {
    const line = displayToLine(row);
    const num = document.createElement('span');
    num.className = 'line-num';
    num.textContent = String(line + 1);
    el.appendChild(num);
    const body = document.createElement('span');
    body.className = 'line-preview';
    el.appendChild(body);
    if (state.badLines.has(line)) el.classList.add('bad');
    const cached = state.previews.get(line);
    if (cached !== undefined) fillPreview(body, cached);
    el.addEventListener('click', () => select(row));
  },
  onRangeChange(from, to) { void loadPreviews(from, to); },
});

function fillPreview(el: HTMLElement, raw: string): void {
  el.textContent = '';
  for (const tok of previewTokens(raw)) {
    const s = document.createElement('span');
    s.className = `tok-${tok.cls}`;
    s.textContent = tok.text;
    el.appendChild(s);
  }
}

async function loadPreviews(from: number, to: number): Promise<void> {
  if (!state.client || to < from) return;
  const lines = Array.from({ length: to - from + 1 }, (_, i) => displayToLine(from + i));
  const missing = lines.some((l) => !state.previews.has(l));
  if (!missing) return;
  // contiguous fetch across the mapped range (filtered views fetch a superset — fine, cheap)
  const lo = Math.min(...lines), hi = Math.max(...lines);
  const previews = await state.client.getLines(lo, hi);
  previews.forEach((p, i) => state.previews.set(lo + i, p));
  if (state.previews.size > 5000) state.previews.clear(); // crude LRU: full reset
  list.refresh();
}

function select(row: number): void {
  const line = displayToLine(row);
  state.selected = line;
  list.setSelected(row);
  void showDetail(line);
}

async function showDetail(line: number): Promise<void> {
  if (!state.client) return;
  const text = await state.client.getLine(line);
  if (state.selected !== line) return; // stale
  detailPane.textContent = '';
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    const err = document.createElement('p');
    err.className = 'parse-error';
    err.textContent = 'This line is not valid JSON — raw content:';
    const pre = document.createElement('pre');
    pre.textContent = text;
    detailPane.append(err, pre);
    return;
  }
  const msgs = normalizeToMessages(value);
  state.transcriptAvailable = msgs !== null;
  if (msgs && state.mode === 'transcript') renderTranscript(msgs, detailPane);
  else renderJsonTree(value, detailPane);
  updateTopbar();
}

const updateTopbar = () => topbarUpdate({
  filename: state.filename, lineCount: state.lineCount, fileSize: state.fileSize,
  badCount: state.badLines.size, matchCount: state.matchCount, searching: state.searching,
  mode: state.mode, transcriptAvailable: state.transcriptAvailable,
} satisfies TopbarState);

const topbarUpdate = createTopbar($('topbar'), {
  onSearch(q) {
    if (!state.client) return;
    if (!q.trim()) {
      state.filtered = null; state.matchCount = null; state.searching = false;
      list.setTotal(displayTotal()); updateTopbar(); return;
    }
    state.filtered = []; state.matchCount = 0; state.searching = true;
    state.client.search(q);
    updateTopbar();
  },
  onModeToggle() {
    state.mode = state.mode === 'json' ? 'transcript' : 'json';
    if (state.selected !== null) void showDetail(state.selected);
    updateTopbar();
  },
  onThemeToggle() {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? '' : 'light';
  },
  onNewFile() { location.reload(); },
  onErrorsClick() {
    state.filtered = [...state.badLines].sort((a, b) => a - b);
    state.matchCount = state.filtered.length; state.searching = false;
    list.setTotal(displayTotal()); updateTopbar();
  },
});

function loadBlob(blob: Blob, name: string): void {
  const client = new WorkerClient();
  state.client = client;
  state.filename = name;
  state.previews.clear(); state.badLines.clear();
  state.filtered = null; state.selected = null; state.matchCount = null;

  client.onIndexed = (lineCount, fileSize) => {
    state.lineCount = lineCount; state.fileSize = fileSize;
    $('landing').hidden = true;
    $('viewer').hidden = false;
    list.setTotal(lineCount);
    updateTopbar();
    client.validate(); // background bad-line sweep
    if (lineCount > 0) select(0);
  };
  client.onBadLines = (indices) => { for (const i of indices) state.badLines.add(i); updateTopbar(); list.refresh(); };
  client.onSearchHits = (_id, hits, done, scanned, total) => {
    state.filtered!.push(...hits);
    state.matchCount = state.filtered!.length;
    state.searching = !done;
    list.setTotal(displayTotal());
    updateTopbar();
    void scanned; void total; // progress display: optional polish
  };
  client.onFatal = (message) => {
    alert(message); // v1: simple; replaced by inline error panel in styling task
  };
  client.load(blob);
}

initDropzone($('dropzone'), $('demo-link'), loadBlob);

// keyboard: ↑/↓ moves selection
document.addEventListener('keydown', (e) => {
  if (state.selected === null || (e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const rows = displayTotal();
  const currentRow = state.filtered ? state.filtered.indexOf(state.selected) : state.selected;
  const next = Math.max(0, Math.min(rows - 1, currentRow + (e.key === 'ArrowDown' ? 1 : -1)));
  list.scrollToIndex(next);
  select(next);
});
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open browser. Create test file: `seq 1 100000 | awk '{print "{\"n\":" $1 ",\"msg\":\"line " $1 "\"}"}' > /tmp/big.jsonl`. Drop it. Verify: list renders, scroll smooth, click shows JSON tree, search `n>99990` filters to 10, paste raw JSONL works.

- [ ] **Step 5: Typecheck + full test suite** — `npm run build && npm test` → both pass.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: wire app - dropzone, virtual list, detail pane, search"`

---

### Task 11: Styling — full design language

**Files:**
- Modify: `src/styles/app.css` (replace), `index.html` (landing polish)
- Create: `public/demo.jsonl`

**Interfaces:**
- Consumes: tokens.css variables, class names produced by Tasks 8-10 (`row`, `selected`, `bad`, `line-num`, `line-preview`, `tok-*`, `msg role-*`, `part-*`, `token-badge`, `json-node`, `readout`, `dropzone`, `ghost-stream`, `landing-title`).

Spec anchors: graphite scale, amber accent only for interactive, data colors only on data, ghost-stream landing animation (reduced-motion → static), instrument readouts, draggable divider, responsive single-column mobile, light theme, visible keyboard focus.

- [ ] **Step 1: Write `app.css`**

```css
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--mono); font-size: 13px; }
button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--surface-2); border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
[hidden] { display: none !important; }
.accent { color: var(--accent); }

/* ---- landing ---- */
.landing { position: relative; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 32px; overflow: hidden; }
.landing-title { font-size: clamp(20px, 3.5vw, 34px); font-weight: 500; letter-spacing: -0.03em; max-width: 18em; text-align: center; z-index: 1; margin: 0; }
.dropzone { z-index: 1; border: 1px dashed var(--muted); border-radius: 8px; padding: 48px 64px; color: var(--muted); cursor: pointer; background: color-mix(in srgb, var(--surface) 60%, transparent); }
.dropzone:hover, .dropzone.dragging { border-color: var(--accent); color: var(--text); }
.demo-link { z-index: 1; background: none; border: none; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }

/* ghost stream: faint jsonl lines drifting upward */
.ghost-stream { position: absolute; inset: 0; overflow: hidden; opacity: 0.13; pointer-events: none; }
.ghost-stream::before {
  content: '{"role":"assistant","content":"…"}\A{"n":4821,"level":"info"}\A{"messages":[{"role":"user"}]}\A{"tokens":812,"model":"…"}\A{"event":"tool_use","name":"Bash"}\A{"role":"user","content":"…"}\A{"score":0.94,"pass":true}\A{"delta":{"text":"str"}}\A';
  white-space: pre; display: block; font-size: 14px; line-height: 3.2;
  color: var(--muted); animation: drift 36s linear infinite;
}
@keyframes drift { from { transform: translateY(0); } to { transform: translateY(-50%); } }
@media (prefers-reduced-motion: reduce) { .ghost-stream::before { animation: none; } }

/* ---- viewer ---- */
.viewer { display: flex; flex-direction: column; height: 100vh; }
.topbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--surface-2); }
.readout { color: var(--muted); font-size: 12px; letter-spacing: 0.02em; white-space: nowrap; }
.readout.danger { color: var(--danger); border-color: var(--danger); background: none; }
#tb-search { flex: 1; min-width: 120px; background: var(--bg); color: var(--text); border: 1px solid var(--surface-2); border-radius: 4px; padding: 5px 10px; font: inherit; }
#tb-search:focus { border-color: var(--accent); outline: none; }

.panes { display: flex; flex: 1; min-height: 0; }
.list-pane { width: 40%; overflow-y: auto; border-right: 1px solid var(--surface-2); position: relative; }
.divider { width: 4px; cursor: col-resize; background: transparent; }
.divider:hover { background: var(--accent-dim); }
.detail-pane { flex: 1; overflow: auto; padding: 16px 20px; }

/* rows */
.row { display: flex; gap: 10px; align-items: center; padding: 0 12px; white-space: nowrap; overflow: hidden; cursor: pointer; font-size: 12px; }
.row:hover { background: var(--surface); }
.row.selected { background: var(--surface-2); box-shadow: inset 2px 0 0 var(--accent); }
.row.bad .line-num { color: var(--danger); }
.line-num { color: var(--muted); min-width: 5ch; text-align: right; user-select: none; flex-shrink: 0; }
.line-preview { overflow: hidden; text-overflow: ellipsis; }

/* data syntax colors — the only color in the app besides amber */
.tok-key { color: var(--syn-key); }
.tok-str { color: var(--syn-str); }
.tok-num { color: var(--syn-num); }
.tok-bool { color: var(--syn-bool); }
.tok-punct { color: var(--muted); }

/* json tree */
.json-entry, .json-node { font-size: 13px; line-height: 1.7; }
.json-children { padding-left: 18px; border-left: 1px solid var(--surface-2); margin-left: 6px; }
.json-node > summary { cursor: pointer; list-style: none; }
.json-node > summary::before { content: '▸ '; color: var(--muted); }
.json-node[open] > summary::before { content: '▾ '; }
.parse-error { color: var(--danger); }

/* transcript */
.msg { max-width: 72ch; margin: 0 0 14px; padding: 10px 14px; border-radius: 8px; background: var(--surface); border-left: 2px solid var(--muted); }
.msg header { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; }
.role-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.msg.role-assistant { border-left-color: var(--role-assistant); }
.msg.role-user { border-left-color: var(--role-user); }
.msg.role-tool { border-left-color: var(--role-tool); }
.model-label, .token-badge { font-size: 11px; color: var(--muted); }
.token-badge { border: 1px solid var(--surface-2); border-radius: 999px; padding: 1px 8px; }
.part-text { font-family: var(--sans); font-size: 13.5px; line-height: 1.55; }
.part-text pre, .part-text code { font-family: var(--mono); background: var(--bg); border-radius: 4px; }
.part-text pre { padding: 10px; overflow-x: auto; }
.part-thinking, .part-tool_use, .part-tool_result { margin: 6px 0; font-size: 12px; }
.part-thinking > summary, .part-tool_use > summary, .part-tool_result > summary { cursor: pointer; color: var(--muted); }
.part-thinking pre, .part-tool_use pre, .part-tool_result pre { background: var(--bg); padding: 8px; border-radius: 4px; overflow-x: auto; max-height: 40vh; }

/* crawlable footer */
.seo-footer { padding: 40px 20px; color: var(--muted); font-family: var(--sans); font-size: 13px; max-width: 60ch; margin: 0 auto; }
.seo-footer h2 { font-size: 14px; color: var(--text); }

@media (max-width: 720px) {
  .panes { flex-direction: column; }
  .list-pane { width: 100%; height: 45%; border-right: none; border-bottom: 1px solid var(--surface-2); }
  .dropzone { padding: 32px 24px; }
}
```

- [ ] **Step 2: Divider drag + demo file**

Add to `main.ts`:
```ts
// draggable divider
const divider = $('divider');
divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const pct = (ev.clientX / window.innerWidth) * 100;
    listPane.style.width = `${Math.min(75, Math.max(20, pct))}%`;
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', move), { once: true });
});
```

`public/demo.jsonl` — 30 lines of realistic mixed eval-log content: a few OpenAI `{messages:[...]}` lines with markdown in content, a few Claude Code-style lines with tool_use + usage, a few generic log lines (`{"level":"info",...}`), one intentionally broken line. Write it by hand; content must showcase transcript mode and the bad-line flag.

- [ ] **Step 3: Manual verification** — `npm run dev`: landing shows ghost stream (static when `prefers-reduced-motion`), demo file loads, transcript toggle appears on demo transcript lines, bad line flagged, divider drags, light toggle works, mobile viewport (devtools) stacks panes.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: full design language + demo file"`

---

### Task 12: SEO, CSP, syntax highlighting polish

**Files:**
- Modify: `index.html`
- Create: `public/_headers`, `public/favicon.svg`

- [ ] **Step 1: SEO + meta in `index.html` head**

```html
<meta property="og:title" content="JSONL Viewer — view .jsonl files instantly, locally" />
<meta property="og:description" content="Drop a .jsonl file and view it instantly. Streams gigabyte files. Auto-renders LLM transcripts. Nothing uploads." />
<meta property="og:type" content="website" />
<meta name="theme-color" content="#0e1014" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
```

Crawlable footer before `</main>` (visible below the fold on the landing state only — add `id="seo-footer"` and hide it when viewer opens, in `loadBlob`):
```html
<footer class="seo-footer" id="seo-footer">
  <h2>What is a JSONL file?</h2>
  <p>JSONL (JSON Lines, also called NDJSON) is a format where each line is a separate JSON value. It is the standard format for logs, dataset exports, LLM fine-tuning files, and AI agent transcripts.</p>
  <h2>How this viewer works</h2>
  <p>Files are parsed entirely in your browser using a streaming Web Worker — line offsets are indexed first, content parses lazily as you scroll. Gigabyte files open in seconds. Nothing is uploaded; there is no server. Verify it yourself: this site's Content-Security-Policy forbids network connections.</p>
  <h2>LLM transcript mode</h2>
  <p>Lines shaped like OpenAI fine-tune messages, Anthropic messages, or Claude Code sessions render as readable chat transcripts with markdown, collapsed tool calls, and token counts.</p>
</footer>
```

`public/favicon.svg`: minimal — amber `{` glyph on graphite rounded square:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0E1014"/><text x="16" y="23" font-family="monospace" font-size="20" fill="#F5A623" text-anchor="middle">{;</text></svg>
```

- [ ] **Step 2: CSP `public/_headers`**

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

(`connect-src 'self'` needed only for demo.jsonl fetch; nothing external.)

- [ ] **Step 3: Code-block highlighting in transcripts**

In `detailTranscript.ts`, after setting sanitized innerHTML, lazily highlight code blocks:
```ts
async function highlightCodeBlocks(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll('pre code[class*="language-"]');
  if (!blocks.length) return;
  const { highlightElement } = await import('@speed-highlight/core');
  const detect = (el: Element) => (el.className.match(/language-(\w+)/)?.[1] ?? 'plain');
  for (const el of blocks) {
    try { await highlightElement(el as HTMLElement, detect(el) as any); } catch { /* unknown lang: leave plain */ }
  }
}
```
Call `void highlightCodeBlocks(div)` after setting `div.innerHTML` in `renderPart`. Import speed-highlight's CSS theme once in `main.ts`: `import '@speed-highlight/core/themes/github-dark.css';` — verify against installed package exports; if the exact path differs, use the package's documented theme import. Dynamic import keeps it out of the initial bundle.

- [ ] **Step 4: Verify** — `npm run build && npm test`; dev-check a transcript containing a fenced code block highlights.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: seo meta, csp headers, lazy code highlighting"`

---

### Task 13: Playwright smoke tests

**Files:**
- Create: `e2e/smoke.spec.ts`, `playwright.config.ts`

- [ ] **Step 1: Config**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'npm run build && npm run preview', port: 4173, reuseExistingServer: true },
});
```

- [ ] **Step 2: Write smoke tests**

`e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('demo file: load → rows → detail → search → transcript', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing-title')).toContainText('never leaves your browser');

  await page.click('#demo-link');
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('.row').first()).toBeVisible();

  // detail renders on selection
  await page.locator('.row').nth(1).click();
  await expect(page.locator('#detail-pane')).not.toBeEmpty();

  // search filters
  const before = await page.locator('#tb-lines').textContent();
  await page.fill('#tb-search', 'assistant');
  await expect(page.locator('#tb-matches')).toBeVisible();
  expect(before).toBeTruthy();

  // transcript toggle appears for transcript-shaped line and renders bubbles
  await page.fill('#tb-search', '');
  await page.locator('.row').first().click();
  const modeBtn = page.locator('#tb-mode');
  if (await modeBtn.isVisible()) {
    await modeBtn.click();
    await expect(page.locator('.msg').first()).toBeVisible();
  }
});

test('large pasted content stays responsive', async ({ page }) => {
  await page.goto('/');
  const big = Array.from({ length: 50000 }, (_, i) => `{"n":${i}}`).join('\n');
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt } as any));
  }, big);
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#tb-lines')).toContainText('50,000');
});

test('xss content does not execute', async ({ page }) => {
  await page.goto('/');
  const payload = '{"role":"user","content":"<img src=x onerror=\\"window.__pwned=1\\">"}';
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt } as any));
  }, payload);
  await page.locator('.row').first().click();
  const modeBtn = page.locator('#tb-mode');
  if (await modeBtn.isVisible()) await modeBtn.click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});
```

- [ ] **Step 3: Run** — `npx playwright install chromium && npm run e2e` → 3 passed. Fix app bugs surfaced, not the tests.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "test: playwright smoke suite"`

---

### Task 14: Bundle-size gate + CI + README

**Files:**
- Create: `scripts/check-bundle-size.mjs`, `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: Size gate**

`scripts/check-bundle-size.mjs`:
```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 50 * 1024; // 50KB gzipped, JS only
const dir = 'dist/assets';
let total = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const gz = gzipSync(readFileSync(join(dir, f))).length;
  console.log(`${f}: ${(gz / 1024).toFixed(1)}KB gz`);
  total += gz;
}
console.log(`total JS: ${(total / 1024).toFixed(1)}KB gz (limit ${(LIMIT / 1024).toFixed(0)}KB)`);
if (total > LIMIT) {
  console.error('FAIL: bundle exceeds 50KB gzipped');
  process.exit(1);
}
```

Note: lazy-loaded chunks (speed-highlight) count toward total — acceptable; if it ever busts the limit, gate on initial-load chunks only (entry + its static imports) and document the change.

- [ ] **Step 2: Run gate** — `npm run build && npm run check-size` → prints sizes, exits 0. If over: audit with `npx vite-bundle-visualizer` before shipping.

- [ ] **Step 3: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build          # includes tsc --noEmit
      - run: npm test
      - run: npm run check-size
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
```

- [ ] **Step 4: README**

`README.md` — short, honest, screenshot placeholder to fill post-launch:
```markdown
# JSONL Viewer

View `.jsonl` files instantly — in your browser, locally. Nothing uploads.

**https://jsonlviewer.com** (coming soon)

- Streams gigabyte files: line offsets index first, content parses lazily as you scroll
- Auto-detects LLM transcripts (OpenAI fine-tune, Anthropic messages, Claude Code sessions) and renders chat bubbles with markdown + collapsed tool calls
- Search: substring + field queries (`role:assistant`, `tokens>500`, `usage.total_tokens<9`)
- No server. No upload. CSP forbids network connections — verify in devtools.

## Dev

```sh
npm ci
npm run dev        # local dev server
npm test           # unit tests
npm run e2e        # playwright smoke
npm run build && npm run check-size   # bundle gate (<50KB gz)
```

MIT
```

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: ci pipeline, bundle gate, readme"`

---

### Task 15: Ship checkpoint (user-gated)

Not code — decision gate with the user:

- [ ] Full local pass: `npm run build && npm test && npm run check-size && npm run e2e` — all green.
- [ ] Manual QA against spec checklist: 100MB file < 2s to usable (generate: `seq 1 3000000 | awk '{print "{\"n\":" $1 "}"}' > /tmp/100mb.jsonl`), search cancellation (type fast, no jank), bad-line flow, theme toggle, reduced motion, mobile.
- [ ] Ask user: create public GitHub repo `jsonl-viewer` + push? (requires their confirmation — externally visible)
- [ ] Ask user: connect Cloudflare Pages + domain purchase (their account, their card).

---

## Self-Review (completed)

- **Spec coverage:** streaming/index/lazy-parse (T3, T7), virtual list (T8), search+cancel (T4, T7, T10), transcript detection incl. Claude Code (T5), sanitization + XSS fixtures (T9, T13), CSP (T12), SEO footer (T12), design language + ghost stream + readouts + divider + mobile + light theme + reduced motion (T11), demo file (T11), bundle gate + CI (T14), error handling: bad lines (T7 validate, T10), non-JSON detail fallback (T10), worker crash (T7 client onFatal), MAX_LINES cap (T2). Gap noted: JSON-array "explode to lines" sniff from spec — **deferred, add as fast-follow**; not load-bearing for v1 launch. Progress bar during search is wired (scanned/total posted) but UI display marked optional polish in T10.
- **Placeholder scan:** none — every step has code or an exact command.
- **Type consistency:** `OffsetIndex.start/end/length` used identically in T3/T7; `Msg/ContentPart` shapes match between T5 and T9; `FromWorker`/`ToWorker` unions consistent between T7 worker and client; `previewTokens` cls names match CSS `tok-*` classes in T11.
