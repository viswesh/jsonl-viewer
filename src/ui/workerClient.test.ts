import { describe, it, expect, beforeEach } from 'vitest';
import { WorkerClient } from './workerClient';
import type { FromWorker } from '../worker/protocol';

let instances: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: any[] = [];
  constructor() { instances.push(this); }
  postMessage(m: any) { this.posted.push(m); }
  emit(data: FromWorker) { this.onmessage?.({ data } as MessageEvent); }
  terminate() {}
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

  it('settles a superseded getLines promise so concurrent callers never hang', async () => {
    const client = new WorkerClient();
    const w = last();

    const staleP = client.getLines(0, 9);   // superseded
    const freshP = client.getLines(10, 19); // latest

    const reqs = w.posted.filter((m) => m.type === 'getLines');
    const staleReq = reqs[0]!;
    const freshReq = reqs[1]!;

    // Worker replies to both; stale reqId !== latestLinesReq.
    w.emit({ type: 'lines', reqId: freshReq.reqId, from: 10, previews: ['fresh'] });
    w.emit({ type: 'lines', reqId: staleReq.reqId, from: 0, previews: ['stale-data'] });

    const [stale, fresh] = await Promise.all([staleP, freshP]);
    expect(fresh).toEqual(['fresh']);
    expect(stale).toEqual([]); // stale resolves empty, never hangs
  });
});
