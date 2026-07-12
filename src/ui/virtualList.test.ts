import { describe, it, expect } from 'vitest';
import { visibleRange } from './virtualList';

describe('visibleRange', () => {
  it('computes window with overscan', () => {
    expect(visibleRange(0, 280, 28, 1000, 5)).toEqual({ from: 0, to: 14 }); // 10 visible + 5 over
    expect(visibleRange(2800, 280, 28, 1000, 5)).toEqual({ from: 95, to: 114 });
  });
  it('clamps at end', () => {
    expect(visibleRange(27700, 280, 28, 1000, 5)).toEqual({ from: 984, to: 999 });
  });
  it('handles zero rows', () => {
    expect(visibleRange(0, 280, 28, 0, 5)).toEqual({ from: 0, to: -1 });
  });
});
