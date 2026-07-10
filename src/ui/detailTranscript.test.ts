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
