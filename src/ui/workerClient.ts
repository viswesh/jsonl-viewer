import type { ToWorker, FromWorker } from '../worker/protocol';

export class WorkerClient {
  onIndexProgress?: (lines: number, bytes: number, totalBytes: number) => void;
  onIndexed?: (lineCount: number, fileSize: number) => void;
  onSearchHits?: (searchId: number, hits: number[], done: boolean, scanned: number, total: number) => void;
  onBadLines?: (indices: number[], done: boolean) => void;
  onFatal?: (message: string) => void;

  private worker: Worker;
  private reqId = 0;
  private searchId = 0;
  private pendingLines = new Map<number, (previews: string[]) => void>();
  private pendingLine = new Map<number, (text: string) => void>();
  private latestLinesReq = 0; // stale getLines results are dropped

  constructor() {
    this.worker = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.dispatch(e.data);
    this.worker.onerror = () => this.onFatal?.('Worker crashed — the file may be too large for this device.');
  }

  private dispatch(m: FromWorker): void {
    switch (m.type) {
      case 'indexProgress': this.onIndexProgress?.(m.lines, m.bytes, m.totalBytes); break;
      case 'indexed': this.onIndexed?.(m.lineCount, m.fileSize); break;
      case 'lines': {
        const resolve = this.pendingLines.get(m.reqId);
        this.pendingLines.delete(m.reqId);
        // stale request superseded by a newer one: settle with [] so callers never hang
        resolve?.(m.reqId === this.latestLinesReq ? m.previews : []);
        break;
      }
      case 'line': this.pendingLine.get(m.reqId)?.(m.text); this.pendingLine.delete(m.reqId); break;
      case 'searchHits':
        if (m.searchId === this.searchId) this.onSearchHits?.(m.searchId, m.hits, m.done, m.scanned, m.total);
        break;
      case 'badLines': this.onBadLines?.(m.indices, m.done); break;
      case 'fatal': this.onFatal?.(m.message); break;
    }
  }

  private send(m: ToWorker): void { this.worker.postMessage(m); }

  load(blob: Blob): void { this.send({ type: 'load', blob }); }

  getLines(from: number, to: number): Promise<string[]> {
    const reqId = ++this.reqId;
    this.latestLinesReq = reqId; // supersedes any in-flight preview request
    return new Promise((res) => { this.pendingLines.set(reqId, res); this.send({ type: 'getLines', from, to, reqId }); });
  }

  getLine(index: number): Promise<string> {
    const reqId = ++this.reqId;
    return new Promise((res) => { this.pendingLine.set(reqId, res); this.send({ type: 'getLine', index, reqId }); });
  }

  search(query: string): number {
    const id = ++this.searchId;
    this.send({ type: 'search', query, searchId: id });
    return id;
  }

  validate(): void { this.send({ type: 'validate' }); }
}
