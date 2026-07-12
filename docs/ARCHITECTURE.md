# Architecture

## Design constraints

Two numbers shape every decision in this codebase:

- **< 50KB gzipped JS**, enforced by `npm run check-size` and blocking in CI (`scripts/check-bundle-size.mjs`). Current total is ~38KB.
- **No framework.** Vite + vanilla TypeScript, compiled to static files. No React/Vue/Svelte runtime tax before the app's own code even starts.

Everything else — no server, streaming-first, worker-owned I/O — follows from those two.

## Why no framework

A framework runtime is 15–45KB before a single line of app code runs. At this bundle budget, that's the entire budget. The UI here is also unusually mechanical: a fixed-height virtualized list and a handful of DOM-building functions (`renderJsonTree`, `renderTranscript`) — the kind of code a reconciler adds overhead to rather than value.

## Runtime dependencies — and why only these three

| Package | Why it's here | Why nothing else does the job |
|---|---|---|
| [`marked`](https://github.com/markedjs/marked) | Parses markdown inside transcript messages (assistant responses often contain formatted text, code fences, lists). | Smallest maintained markdown parser with correct CommonMark handling; hand-rolling markdown is a correctness trap. |
| [`dompurify`](https://github.com/cure53/DOMPurify) | Sanitizes `marked`'s HTML output before it touches the DOM. **Required, not optional** — see [Security](#security-model). | No credible substitute; this is the one dependency where "just be careful" isn't an acceptable answer. |
| [`@speed-highlight/core`](https://github.com/speed-highlight/core) | Syntax-highlights fenced code blocks inside transcript messages, lazily. | Smallest maintained highlighter; loaded via dynamic `import()` so it never touches the initial bundle (see [Bundle budget](#bundle-budget)). |

Everything else — the virtualized list, the line indexer, the JSON tree renderer, the search matcher — is hand-rolled. Each is small enough that a library would cost more in bytes than it saves in code.

## Data flow

```
File dropped/pasted
      │
      ▼
main thread wraps pasted text in a Blob — one code path for drop, paste, and file-picker
      │
      ▼
Web Worker (src/worker/worker.ts)
      │
      ├─ indexBlob(): streams the Blob via .stream(), scans bytes for 0x0A,
      │   records each line's START OFFSET only — no parsing, no content held in memory
      │
      ├─ readLine(): given an offset, slices + decodes exactly one line on demand
      │
      └─ search(): scans lines, applies a query (see below), posts matches in
          batches with cancellation — a new keystroke invalidates the in-flight scan
      │
      ▼
main thread (src/main.ts) — a small state machine
      │
      ├─ VirtualList (src/ui/virtualList.ts): renders only the visible row window,
      │   recycling DOM nodes as you scroll — this is what makes a 10M-line file
      │   scroll like a 10-line file
      │
      └─ on row click: normalizeToMessages() checks if the line is a known
          transcript shape → renderTranscript() (chat bubbles) or renderJsonTree()
          (collapsible tree)
```

The worker never returns the whole file to the main thread — only line offsets, and later, individual line strings on demand. This is why a multi-gigabyte file opens in roughly the time it takes to stream it once, not the time it takes to parse it.

## The virtualized list

`src/ui/virtualList.ts` renders a fixed number of DOM rows (viewport height ÷ row height, plus a small overscan) and repositions/reuses them as you scroll, rather than mounting one DOM node per line. `visibleRange()` is the pure math behind this and is unit-tested in isolation from the DOM.

Two update paths exist because they have different scroll-position contracts:
- **`setTotal(n)`** — used when the *set of lines* changes (new file, search applied/cleared, errors filter). Clears and remounts every visible row, and resets scroll to top, because old rows may now map to different content.
- **`updateCount(n)`** — used when a streaming search only *appends* to the existing filtered set. Resizes the list without touching scroll position, so a multi-batch search doesn't keep snapping the view back to the top mid-scan.

## Transcript detection

See [DETECTION.md](DETECTION.md) for the full algorithm and how to add a new LLM message format. In short: `normalizeToMessages()` runs a cheap structural check **per line** (not per file, since real-world JSONL mixes shapes) and returns `null` for anything that isn't a recognizable message — those lines render as plain JSON.

## Search

`src/core/query.ts` parses the search box into a small term language:
- Bare words are case-insensitive substring matches against the raw line text — no parsing required, so this is fast even on malformed lines.
- `field:value` matches a key by name; a dot path (`usage.total_tokens`) matches that exact nested path, while a bare key matches the first occurrence at any depth in document order.
- `field>value` / `field<value` are numeric comparisons.
- `field:*` checks existence.
- Space-separated terms are ANDed.

Search executes in the worker so the UI thread never blocks, and every keystroke invalidates the previous in-flight scan (`searchId` sequencing in `src/ui/workerClient.ts` and `src/worker/worker.ts`) so late results from an abandoned query can never overwrite the current view.

## Security model

File content is untrusted input, full stop. The two rendering paths handle this differently:

- **JSON tree (`src/ui/detailJson.ts`)** — every value is set via `textContent`. There is no `innerHTML` anywhere in this file, by design; a JSON value can never become markup.
- **Transcript (`src/ui/detailTranscript.ts`)** — message text is markdown, so it does need to become HTML. The only path is `marked.parse(text)` → `DOMPurify.sanitize(...)` → `innerHTML`. This is the single sanitization boundary in the app; nothing else touches `innerHTML` with file-derived content. Syntax highlighting (`@speed-highlight/core`) runs *after* this boundary, directly manipulating already-sanitized DOM nodes — it never receives or re-injects a raw string.

See [SECURITY.md](../SECURITY.md) for the full threat model, the CSP, and how to report a vulnerability.

## Bundle budget

`scripts/check-bundle-size.mjs` gzips every `.js` file Vite emits to `dist/assets` and fails the build if the total exceeds 50KB. This runs in CI (`.github/workflows/ci.yml`) as a blocking, deterministic gate — unlike a perf-timing gate, bundle size doesn't vary between CI runs.

The lazy `@speed-highlight/core` chunk is loaded via dynamic `import()` only when a transcript message actually contains a fenced code block — most transcripts don't, so most page loads never fetch it. If a future dependency ever pushes the *initial-load* bundle over budget while lazy chunks keep the *sum* under it, the fallback (documented inline in the script) is to gate on initial-load chunks only, derived from `dist/index.html`'s `<script>`/`modulepreload` tags — not to raise the limit.
