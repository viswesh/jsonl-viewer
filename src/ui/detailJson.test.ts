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

  it('collapses a large top-level array (root wrapped, lazy)', () => {
    const el = document.createElement('div');
    renderJsonTree(Array.from({ length: 200 }, (_, i) => i), el);
    const details = el.querySelector('details.json-node') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.querySelectorAll('.tok-num').length).toBe(0); // not built until expand
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(el.querySelectorAll('.tok-num').length).toBe(200);
  });

  it('small top-level object stays flattened (no root wrapper)', () => {
    const el = document.createElement('div');
    renderJsonTree({ a: 1, b: 2 }, el);
    // two top-level entries rendered directly, not under a single root details
    expect(el.querySelectorAll('.tok-key').length).toBe(2);
  });
});
