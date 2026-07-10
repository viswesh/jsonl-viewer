# JSONL Viewer — Design

**Date:** 2026-07-10
**Status:** Approved

## Product

An online JSONL viewer for AI engineers. The acquisition loop mirrors classic online JSON viewers: google "jsonl viewer" → land → drop file → see results instantly. Nothing uploads — all parsing happens in-browser. The wedge feature is auto-detected LLM transcript rendering.

**Positioning:** "Drop your .jsonl — it never leaves your browser."

**Primary user:** AI engineers viewing eval logs, fine-tune datasets, agent transcripts (OpenAI fine-tune files, Anthropic message logs, Claude Code sessions).

### Market gap (researched 2026-07-10)

- jsonhero-web (10.8k★): best JSON exploration UX, but single-document JSON only — no JSONL, no streaming.
- Claude transcript tools (claude-code-log, claude-code-transcripts, claude-code-history-viewer): Python/CLI or server-backed, not instant-browser.
- Browser JSONL viewers: sub-10-star unlicensed toys.
- No dedicated OpenAI fine-tune JSONL viewer exists.
- **No tool combines Web Worker streaming + virtualization + transcript mode in a no-server browser package.**

## v1 scope

Lean viewer + transcript mode:

- Drop/paste JSONL → virtualized line list
- Click line → pretty-printed JSON detail
- Search: substring + field query syntax
- Auto-detected LLM transcript rendering (chat bubbles, markdown)

Deferred to v2: table/dataset view, field stats, diffing, custom field mapping.

## Architecture

- **Vite + TypeScript, no framework.** Static output only. React et al. rejected: 45KB framework weight before app code, and a hand-rolled virtualized list beats reconciler overhead at 1M rows.
- **Hard perf budget:** < 50KB gzipped JS total, first paint < 0.5s, 100MB file usable in < 2s. CI enforces the bundle gate.
- **Main thread:** UI only — drop zone, virtualized list, detail pane.
- **Web Worker:** file streaming, line indexing, JSON parsing, search. UI never blocks.

### Data flow

1. File dropped → worker streams via `File.stream()`. **Pasted text is wrapped in `new Blob([text])` and enters the identical pipeline — one code path for both inputs.**
2. Worker scans `Uint8Array` chunks for `0x0A`, stores byte offsets in a chunked/doubling `Float64Array`. No content parsing on the index pass.
3. UI receives line count quickly; list renders.
4. Visible lines parsed lazily on scroll (worker slices file at offsets). Scroll-driven parse requests are coalesced and stale requests cancelled — fast scrolling never queues obsolete work.
5. Click line → full parse → detail pane.

GB files work because we index offsets, not content. Memory model: raw `File` handle + offset index + LRU parse cache of a few hundred entries — never the whole parsed file.

**Known limit:** offset index costs 8 bytes/line (~80MB at 10M lines). Fine for real-world files; past ~50M lines, show a clear "file too large" error rather than OOM silently. Worker crash/OOM surfaces a visible error state in the UI, never a hung spinner.

### Dependencies (sizes verified via bundlejs, 2026-07)

| Need | Pick | gzip | License |
|---|---|---|---|
| Virtual list | hand-rolled fixed-height virtualizer (~60 lines) — list rows are one-line previews, no dynamic measurement needed | 0 KB | — |
| Markdown | `marked` | 12.7 KB | MIT |
| HTML sanitization | `dompurify` — **required**: transcript mode renders untrusted file content; all marked output passes through DOMPurify before touching the DOM | ~7 KB | Apache-2.0/MPL |
| Syntax highlight | `@speed-highlight/core`, lazy-loaded languages | ~4 KB | CC0 |
| Row-preview JSON coloring | hand-rolled ~1 KB tokenizer | ~1 KB | — |
| Line indexing / streaming | hand-rolled (native `File.stream()` + chunk scan) | 0 KB | — |

Total ~25 KB, leaving ~25 KB for app code within budget. The bundled demo file is a lazy-fetched data asset and does not count against the 50KB JS gate.

## UI

### Landing (no file loaded)

Full-viewport drop zone. Headline: "Drop your .jsonl — it never leaves your browser." Paste box (⌘V raw text works), "try demo file" link (lazy-fetched sample eval log). The tool IS the landing page — no marketing chrome above it.

**SEO:** the page must still rank for "jsonl viewer" — semantic HTML, title/meta/OG tags, and a compact crawlable section below the drop zone (what is JSONL, what the tool does, privacy statement). Below the fold, invisible to the drop-file flow, visible to Google.

### Loaded — two-pane layout

- **Top bar:** filename, line count, parse-error count (clickable → filter to bad lines), search box, transcript/JSON toggle, theme toggle, "new file" button.
- **Left pane (~40%):** virtualized line list. Each row: line number, one-line collapsed preview (first ~120 chars, keys colored via hand-rolled tokenizer). Bad-JSON lines flagged red, still viewable raw. Keyboard ↑/↓ navigation.
- **Right pane (~60%):** selected line detail, two modes:
  - **JSON mode:** pretty-printed, syntax-colored, collapsible nodes, copy button.
  - **Transcript mode:** auto-enabled when shape detected. Chat bubbles per message, role labels (system/user/assistant/tool), markdown rendered, code blocks highlighted, long content collapsible. Tool calls and thinking blocks collapsed by default. Per-message token badges where data present. Message-type filter chips with live counts.
- Divider draggable. Mobile: single column, tap line → detail slides over.

### Visual identity — "Data is the interface"

Dark-first, futuristic minimalist. Explicitly avoids the black + acid-green AI-tool default.

**Thesis:** chrome is nearly invisible; all color belongs to the data. Page loads monochrome graphite. Drop a file → the page blooms with the data's own colors (JSON syntax hues, role colors, match highlights). The product moment — your data appearing locally — is the visual moment, and tells the privacy story visually.

- **Palette:** graphite scale — `#0E1014` background, `#1A1D23` surfaces, `#8B919C` muted text, `#E6E8EC` primary text. Single interactive accent: phosphor amber (`#F5A623` family) for controls/focus only — no blue or green anywhere in the chrome.4 restrained data-syntax hues reserved exclusively for JSON tokens and transcript roles.
- **Type:** monospace as display face — headlines set large in mono, tight-tracked. One variable mono woff2 subset (~30KB, `font-display: swap`) for display + data; system sans for small UI labels only.
- **Signature:** landing page — ghost JSONL lines drift slowly upward behind the drop zone, barely visible. `prefers-reduced-motion` → static.
- **Instrument detail** (borrowed from runner-up direction): top-bar stats (line count, file size, error count) styled as precise instrument readouts.
- Light theme toggle retained; light theme derives from the same token system.

## Transcript detection

Runs **per line**, not per file (real JSONL mixes shapes). Cheap structural checks in order:

1. `{messages: [...]}` array with `role` + `content` objects → OpenAI fine-tune/chat style
2. `{role, content}` where content is a string or Anthropic content-block array (`[{type: "text", ...}]`) → message
3. Claude Code session format (`~/.claude/projects/*.jsonl` shape: `type: "user"/"assistant"` wrapper with nested `message`) → transcript
4. Fallback heuristic: object with a `role`-like field + a string field among `content`/`text`/`message` → generic

No match → JSON mode only, transcript toggle hidden.

## Search

One box, worker-executed over indexed lines, results stream in, filter persists across selection.

- Plain text → substring filter on raw line text (no parse needed), live count, match highlighting.
- Field syntax: `role:assistant`, `model:gpt-4`, `tokens>500`, `error:*` (field exists). Field queries parse lines during the scan.
- **Field path semantics:** a bare key (`tokens`) matches that key at any depth, first match wins; a dot path (`usage.total_tokens`) matches the exact path. One unambiguous rule, documented in the UI's search hint.
- Space-separated terms = AND.
- **Cancellation + progress:** each keystroke aborts the in-flight scan and starts fresh; scans over large files show a progress indicator and stream matches incrementally. No keystroke pileup.

## Errors & edge cases

- **Bad JSON lines:** never fail the file. Red flag, raw text in detail pane with parse error, error count in top bar.
- **Huge single lines (10MB+):** preview truncated at index time; detail parses on demand. Detail rendering collapses nodes beyond a size/depth threshold and renders children on expand — a 10MB object must not explode the DOM.
- **Not-JSONL input:** sniff first bytes. Whole-file JSON array → one-click "explode array to lines". Otherwise clear error message.
- **Encodings:** UTF-8 assumed, BOM stripped, invalid sequences replaced. CRLF and missing trailing newline handled at index time.
- **Empty lines:** skipped, not counted.
- **Browser support:** modern evergreen only (File.stream, workers, ES2022).

## Security & privacy

- **XSS:** file content is untrusted input. All markdown-rendered HTML passes through DOMPurify; JSON mode renders via `textContent`/escaping, never `innerHTML` of raw content. XSS fixture file (malicious markdown, `<script>`, event-handler attributes in content fields) in the test suite.
- **CSP:** strict Content-Security-Policy via Cloudflare Pages `_headers` — no external `connect-src`. The CSP itself is proof of the "never leaves your browser" claim; link it from the privacy blurb.
- **Analytics:** Cloudflare Web Analytics (cookieless, page-view level) or nothing. Never any instrumentation touching file content. Stated explicitly on the page.

## Testing

- **Vitest unit:** line indexer (chunk boundaries, CRLF, BOM, no trailing newline), shape detectors (fixture per format), query parser, search matcher, sanitization (XSS fixtures).
- **Fixtures:** real-world samples — OpenAI fine-tune, Claude Code session slice, eval log, broken-lines file, XSS-payload file.
- **Playwright smoke:** drop file → rows render, click → detail, search filters, transcript toggle.
- **CI gates:** bundle-size gate (> 50KB gzip fails — deterministic, blocking). Perf check (100MB synthetic index timing) is informational, not blocking — shared CI runners are too noisy for a hard timing gate.

## Repo, CI/CD, hosting

- **Public GitHub repo** `jsonl-viewer`, MIT license. Public from start — the repo is itself a distribution/virality channel.
- **GitHub Actions on PR:** typecheck → vitest → build → bundle-size gate → Playwright smoke.
- **Cloudflare Pages:** `main` → prod, branches → preview URLs. Free tier, global edge CDN.
- **Domain:** exact-match domain (jsonlviewer.com or similar) via Cloudflare Registrar at launch — SEO for the "jsonl viewer" search channel.
- Conventional commits.

## Order of operations

1. Build locally (repo already initialized)
2. Public GitHub repo + Actions when first version works
3. Cloudflare Pages + domain at launch
