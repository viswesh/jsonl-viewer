# Transcript detection

This is the algorithm behind the "Transcript view" toggle: how JSONL Viewer decides a line is an LLM message and how it normalizes different providers' shapes into one renderable form. All of it lives in `src/core/detect.ts`, and the whole thing is one function: `normalizeToMessages(value: unknown): Msg[] | null`.

## Why per-line, not per-file

Real-world JSONL mixes shapes. A single eval log commonly has plain `{level, msg, ...}` log lines *and* transcript lines in the same file (see `public/demo.jsonl`, which deliberately does this). Detection therefore runs on every line independently — there's no "file format" concept, only "is this specific line a message."

A line that doesn't match any recognized shape returns `null` and renders as plain JSON. That's a correct, common outcome, not a failure — see the note on discoverability in the FAQ below if you're wondering why some rows in a file don't show the transcript toggle.

## The normalized shape

Every detected line becomes an array of `Msg` (an array because the OpenAI shape holds multiple messages per line):

```ts
type Role = 'system' | 'user' | 'assistant' | 'tool' | 'other';

interface ContentPart {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text: string;
  label?: string; // e.g. a tool name
}

interface Msg {
  role: Role;
  parts: ContentPart[];
  tokens?: number;
  model?: string;
}
```

`renderTranscript()` (`src/ui/detailTranscript.ts`) renders one bubble per `Msg`, one block per `ContentPart` — `text` parts go through markdown, `thinking`/`tool_use`/`tool_result` render collapsed by default.

## Detection order

`normalizeToMessages` tries four shapes, in this order, returning as soon as one matches:

### 1. OpenAI fine-tune / chat — `{messages: [...]}`

```json
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]}
```

Every element of `messages` must itself resolve as a single message (step 2's logic) — if any element fails, the whole line is rejected rather than partially rendered.

### 2. A single message — `{role, content}`

```json
{"role": "assistant", "content": "plain string"}
```

`content` can also be an Anthropic-style array of typed blocks:

```json
{"role": "assistant", "content": [
  {"type": "thinking", "thinking": "..."},
  {"type": "text", "text": "..."},
  {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}},
  {"type": "tool_result", "content": "..."}
]}
```

Any block `type` other than `text`/`thinking`/`tool_use`/`tool_result` still renders — falls through to a pretty-printed JSON dump as a `text` part rather than being dropped.

Token/model metadata is opportunistically read here too: `usage.output_tokens` → `usage.total_tokens` → a bare `tokens` field (first one present wins), and a string `model` field. Both are optional and shown in the transcript header when present.

### 3. Claude Code session line — `{type: "user"|"assistant", message: {...}}`

```json
{"type": "assistant", "message": {"role": "assistant", "content": [...]}, "uuid": "..."}
```

This is the shape of `~/.claude/projects/*/*.jsonl` session files. The outer envelope (`type`, `uuid`, `timestamp`, etc.) is ignored; `message` is unwrapped and run through the same single-message logic as step 2, so it inherits token/model extraction for free.

### 4. Generic heuristic — a role-ish key plus a body-ish key

```json
{"speaker": "user", "message": "..."}
```

If nothing above matched, this is the fallback: any object with one of `role | speaker | author | from` as a string field, *and* one of `content | text | message | msg` as a different string field, is treated as a single generic message. This exists for logging formats that clearly encode a conversational turn without matching a specific provider's schema exactly.

If nothing matches any of the four shapes, the function returns `null`.

## Adding a new format

If you're adding support for another provider or tool's export format:

1. Add a fixture line to `tests/fixtures/` (there's already one file per recognized format — follow that pattern).
2. Add a case to `src/core/detect.test.ts` asserting the expected `Msg[]` shape.
3. Insert your detection branch in `normalizeToMessages`, in priority order relative to the existing four — put more specific/structural checks before the generic heuristic (step 4), since it's intentionally the most permissive and should stay last.
4. If your format needs a new `ContentPart` type (beyond `text`/`thinking`/`tool_use`/`tool_result`), add it to the type and to the rendering switch in `src/ui/detailTranscript.ts` — and remember every part's text ultimately reaches the DOM through the DOMPurify boundary (see [SECURITY.md](../SECURITY.md)), so treat new fields as untrusted the same way.

## FAQ: "why don't all my rows show the transcript toggle?"

Only lines that match one of the four shapes above get the toggle — a plain `{level: "info", msg: "..."}` log line correctly has no transcript rendering, since there's no conversation to render. In a typical mixed eval-log file this is expected and often the majority-eligible case; there's currently no visual marker in the row list itself indicating which lines are transcript-eligible before you click them — that's an open, tracked UX improvement (see open issues).
