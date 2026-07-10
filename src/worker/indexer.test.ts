import { describe, it, expect } from 'vitest';
import { indexBlob, readLine } from './indexer';

const blob = (s: string) => new Blob([s]);

describe('indexBlob', () => {
  it('indexes simple lines', async () => {
    const r = await indexBlob(blob('{"a":1}\n{"b":2}\n'));
    expect(r.lineCount).toBe(2);
    expect(await readLine(blob('{"a":1}\n{"b":2}\n'), r.offsets, 0)).toBe('{"a":1}');
    expect(await readLine(blob('{"a":1}\n{"b":2}\n'), r.offsets, 1)).toBe('{"b":2}');
  });

  it('handles missing trailing newline', async () => {
    const b = blob('{"a":1}\n{"b":2}');
    const r = await indexBlob(b);
    expect(r.lineCount).toBe(2);
    expect(await readLine(b, r.offsets, 1)).toBe('{"b":2}');
  });

  it('skips empty lines entirely', async () => {
    const b = blob('{"a":1}\n\n\n{"b":2}\n');
    const r = await indexBlob(b);
    expect(r.lineCount).toBe(2);
    expect(await readLine(b, r.offsets, 1)).toBe('{"b":2}');
  });

  it('trims CRLF', async () => {
    const b = blob('{"a":1}\r\n{"b":2}\r\n');
    const r = await indexBlob(b);
    expect(await readLine(b, r.offsets, 0)).toBe('{"a":1}');
  });

  it('strips BOM on first line', async () => {
    const b = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), '{"a":1}\n']);
    const r = await indexBlob(b);
    expect(await readLine(b, r.offsets, 0)).toBe('{"a":1}');
  });

  it('survives newline landing on chunk boundary (multi-chunk stream)', async () => {
    // Build a blob larger than one 64KB chunk with known lines
    const line = '{"x":"' + 'a'.repeat(1000) + '"}';
    const n = 200; // ~200KB
    const b = blob(Array(n).fill(line).join('\n') + '\n');
    const r = await indexBlob(b);
    expect(r.lineCount).toBe(n);
    expect(await readLine(b, r.offsets, n - 1)).toBe(line);
  });

  it('truncates with maxBytes', async () => {
    const b = blob('{"long":"' + 'x'.repeat(500) + '"}\n');
    const r = await indexBlob(b);
    const s = await readLine(b, r.offsets, 0, 100);
    expect(s.length).toBeLessThanOrEqual(100);
  });

  it('reports progress', async () => {
    let calls = 0;
    await indexBlob(blob('{"a":1}\n'.repeat(1000)), () => { calls++; });
    expect(calls).toBeGreaterThan(0);
  });
});
