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
