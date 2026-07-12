import { describe, it, expect } from 'vitest';
import { OffsetIndex } from './offsets';

describe('OffsetIndex', () => {
  it('stores starts and computes ends from next start', () => {
    const idx = new OffsetIndex();
    idx.push(0);   // line 0 starts at 0
    idx.push(10);  // line 1 starts at 10 (line 0 content is [0,9), newline at 9)
    idx.setFileSize(25);
    expect(idx.length).toBe(2);
    expect(idx.start(0)).toBe(0);
    expect(idx.end(0)).toBe(9);   // next start 10 minus 1 (the \n)
    expect(idx.start(1)).toBe(10);
    expect(idx.end(1)).toBe(25);  // last line: file size (no trailing newline)
  });

  it('grows past initial capacity', () => {
    const idx = new OffsetIndex(4);
    for (let i = 0; i < 100; i++) idx.push(i * 10);
    idx.setFileSize(1000);
    expect(idx.length).toBe(100);
    expect(idx.start(99)).toBe(990);
  });

  it('throws past MAX_LINES', () => {
    const idx = new OffsetIndex(4);
    (idx as any).count = OffsetIndex.MAX_LINES; // simulate; do not loop 50M times
    expect(() => idx.push(1)).toThrow(RangeError);
  });
});
