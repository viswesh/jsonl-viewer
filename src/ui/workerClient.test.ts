import { describe, it, expect, beforeEach } from 'vitest';
import { WorkerClient } from './workerClient';
import type { FromWorker } from '../worker/protocol';

let instances: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: any[] = [];
  terminated = false;
  constructor() { instances.push(this); }
  postMessage(m: any) { this.posted.push(m); }
  emit(data: FromWorker) { this.onmessage?.({ data } as MessageEvent); }
  terminate() { this.terminated = true; }
}

beforeEach(() => { instances = []; (globalThis as any).Worker = FakeWorker as any; });

const last = () => instances[instances.length - 1]!;

describe('WorkerClient', () => {
  it('getLine resolves with the worker line message text', async () => {
    const client = new WorkerClient();
    const w = last();
    const p = client.getLine(3);
    const req = w.posted.find((m) => m.type === 'getLine');
    expect(req).toMatchObject({ type: 'getLine', index: 3 });
    w.emit({ type: 'line', reqId: req.reqId, index: 3, text: 'full text here' });
    await expect(p).resolves.toBe('full text here');
  });

  it('settles a superseded getLinesByIndices promise so concurrent callers never hang', async () => {
    const client = new WorkerClient();
    const w = last();

    const staleP = client.getLinesByIndices([0, 1]);   // superseded
    const freshP = client.getLinesByIndices([10, 11]); // latest

    const reqs = w.posted.filter((m) => m.type === 'getLinesByIndices');
    const staleReq = reqs[0]!;
    const freshReq = reqs[1]!;

    // Worker replies to both; stale reqId !== latestLinesReq.
    w.emit({ type: 'linesByIndices', reqId: freshReq.reqId, indices: [10, 11], previews: ['fresh'] });
    w.emit({ type: 'linesByIndices', reqId: staleReq.reqId, indices: [0, 1], previews: ['stale-data'] });

    const [stale, fresh] = await Promise.all([staleP, freshP]);
    expect(fresh).toEqual(['fresh']);
    expect(stale).toEqual([]); // stale resolves empty, never hangs
  });

  it('getLinesByIndices resolves with previews for exactly the requested indices', async () => {
    const client = new WorkerClient();
    const w = last();
    const p = client.getLinesByIndices([3, 7]);
    const req = w.posted.find((m) => m.type === 'getLinesByIndices');
    expect(req).toMatchObject({ type: 'getLinesByIndices', indices: [3, 7] });
    w.emit({ type: 'linesByIndices', reqId: req.reqId, indices: [3, 7], previews: ['line3', 'line7'] });
    await expect(p).resolves.toEqual(['line3', 'line7']);
  });

  it('terminate() stops the underlying worker', () => {
    const client = new WorkerClient();
    const w = last();
    expect(w.terminated).toBe(false);
    client.terminate();
    expect(w.terminated).toBe(true);
  });
});
