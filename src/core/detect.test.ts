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
