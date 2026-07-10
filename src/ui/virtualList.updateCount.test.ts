// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { VirtualList } from './virtualList';

function makeList() {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', { value: 280, configurable: true });
  document.body.appendChild(container);
  const list = new VirtualList({ container, rowHeight: 28, render() {} });
  return { container, list };
}

describe('VirtualList.updateCount', () => {
  it('resizes the spacer to the new row count', () => {
    const { container, list } = makeList();
    list.updateCount(100);
    const spacer = container.firstElementChild as HTMLElement;
    expect(spacer.style.height).toBe(`${100 * 28}px`);
  });

  it('does NOT reset a non-zero scrollTop (unlike setTotal)', () => {
    const { container, list } = makeList();
    list.setTotal(1000);
    container.scrollTop = 500;
    // jsdom has no real layout, but scrollTop is a settable/readable number property,
    // which is exactly what we need to assert updateCount leaves it alone.
    expect(container.scrollTop).toBe(500);
    list.updateCount(1100);
    expect(container.scrollTop).toBe(500); // preserved mid-stream
  });

  it('setTotal still resets scrollTop to 0 (regression guard)', () => {
    const { container, list } = makeList();
    list.setTotal(1000);
    container.scrollTop = 500;
    list.setTotal(1100);
    expect(container.scrollTop).toBe(0);
  });
});
