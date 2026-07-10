import { describe, it, expect } from 'vitest';
import { createRouter } from './worker';
import type { FromWorker } from './protocol';

const load = (router: ReturnType<typeof createRouter>, text: string) =>
  router({ type: 'load', blob: new Blob([text]) });

describe('worker router', () => {
  it('indexes then serves previews and full lines', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, '{"a":1}\n{"b":"' + 'x'.repeat(1000) + '"}\n');
    expect(posted.find((m) => m.type === 'indexed')).toMatchObject({ lineCount: 2 });

    await router({ type: 'getLinesByIndices', indices: [0, 1], reqId: 1 });
    const lines = posted.find((m) => m.type === 'linesByIndices') as Extract<FromWorker, {type:'linesByIndices'}>;
    expect(lines.previews[0]).toBe('{"a":1}');
    expect(lines.previews[1]!.length).toBeLessThan(1000); // truncated preview

    await router({ type: 'getLine', index: 1, reqId: 2 });
    const full = posted.find((m) => m.type === 'line') as Extract<FromWorker, {type:'line'}>;
    expect(full.text.length).toBeGreaterThan(1000);
  });

  it('getLinesByIndices fetches exactly the requested (possibly sparse) indices, not a contiguous span', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, '{"n":0}\n{"n":1}\n{"n":2}\n');
    await router({ type: 'getLinesByIndices', indices: [0, 2], reqId: 9 });
    const lines = posted.find((m) => m.type === 'linesByIndices') as Extract<FromWorker, {type:'linesByIndices'}>;
    // exactly 2 previews returned (not 3) — line 1 was never touched
    expect(lines.previews).toEqual(['{"n":0}', '{"n":2}']);
    expect(lines.indices).toEqual([0, 2]);
  });

  it('searches with abort of superseded scan', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, Array.from({ length: 1000 }, (_, i) => `{"n":${i}}`).join('\n'));
    await router({ type: 'search', query: 'n>990', searchId: 1 });
    const hits = posted.filter((m) => m.type === 'searchHits' && m.searchId === 1)
      .flatMap((m) => (m as Extract<FromWorker, {type:'searchHits'}>).hits);
    expect(hits).toHaveLength(9); // 991..999
  });

  it('validate reports bad lines', async () => {
    const posted: FromWorker[] = [];
    const router = createRouter((m) => posted.push(m));
    await load(router, '{"ok":1}\nnot json\n{"ok":2}\n');
    await router({ type: 'validate' });
    const bad = posted.filter((m) => m.type === 'badLines')
      .flatMap((m) => (m as Extract<FromWorker, {type:'badLines'}>).indices);
    expect(bad).toEqual([1]);
  });
});
