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
