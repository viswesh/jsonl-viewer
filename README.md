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

## Bundle budget

`check-size` sums the gzipped size of every JS file in `dist/assets` (entry,
worker, and the lazy `speed-highlight` syntax-highlighting chunk) and fails
if the total exceeds 50KB gzip. Current total is well under budget (~38KB).

MIT
