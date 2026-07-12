import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Msg, ContentPart } from '../core/detect';

marked.setOptions({ async: false });

function mdToSafeHtml(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] });
}

// Highlights fenced code blocks already present in the sanitized DOM (post-DOMPurify).
// Operates only on existing elements via speed-highlight's highlightElement API — never
// re-introduces innerHTML from an untrusted string.
async function highlightCodeBlocks(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll('pre code[class*="language-"]');
  if (!blocks.length) return;
  const { highlightElement } = await import('@speed-highlight/core');
  const detect = (el: Element) => (el.className.match(/language-(\w+)/)?.[1] ?? 'plain');
  for (const el of blocks) {
    try { await highlightElement(el as HTMLElement, detect(el) as Parameters<typeof highlightElement>[1]); } catch { /* unknown lang: leave plain */ }
  }
}

function renderPart(part: ContentPart): HTMLElement {
  if (part.type === 'text') {
    const div = document.createElement('div');
    div.className = 'part-text';
    div.innerHTML = mdToSafeHtml(part.text);
    void highlightCodeBlocks(div);
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
