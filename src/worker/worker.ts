import { indexBlob, readLine } from './indexer';
import { parseQuery, matchesLine } from '../core/query';
import type { OffsetIndex } from '../core/offsets';
import type { ToWorker, FromWorker } from './protocol';

const PREVIEW_BYTES = 512;
const BATCH = 500;

export function createRouter(post: (m: FromWorker) => void) {
  let blob: Blob | null = null;
  let offsets: OffsetIndex | null = null;
  let currentSearchId = 0;

  return async function route(msg: ToWorker): Promise<void> {
    try {
      switch (msg.type) {
        case 'load': {
          blob = msg.blob;
          const total = blob.size;
          const r = await indexBlob(blob, (lines, bytes) =>
            post({ type: 'indexProgress', lines, bytes, totalBytes: total }));
          offsets = r.offsets;
          post({ type: 'indexed', lineCount: r.lineCount, fileSize: r.fileSize });
          break;
        }
        case 'getLinesByIndices': {
          if (!blob || !offsets) return;
          const previews: string[] = [];
          for (const i of msg.indices) {
            if (i < 0 || i >= offsets.length) continue;
            previews.push(await readLine(blob, offsets, i, PREVIEW_BYTES));
          }
          post({ type: 'linesByIndices', reqId: msg.reqId, indices: msg.indices, previews });
          break;
        }
        case 'getLine': {
          if (!blob || !offsets) return;
          post({ type: 'line', reqId: msg.reqId, index: msg.index,
                 text: await readLine(blob, offsets, msg.index) });
          break;
        }
        case 'search': {
          if (!blob || !offsets) return;
          currentSearchId = msg.searchId;
          const q = parseQuery(msg.query);
          const total = offsets.length;
          let hits: number[] = [];
          for (let i = 0; i < total; i++) {
            if (currentSearchId !== msg.searchId) return; // superseded
            const raw = await readLine(blob, offsets, i);
            let parsed: unknown, tried = false;
            const getParsed = () => {
              if (!tried) { tried = true; try { parsed = JSON.parse(raw); } catch { parsed = undefined; } }
              return parsed;
            };
            if (matchesLine(raw, q, getParsed)) hits.push(i);
            if (hits.length >= BATCH || (i % 5000 === 4999)) {
              post({ type: 'searchHits', searchId: msg.searchId, hits, done: false, scanned: i + 1, total });
              hits = [];
            }
          }
          post({ type: 'searchHits', searchId: msg.searchId, hits, done: true, scanned: total, total });
          break;
        }
        case 'validate': {
          if (!blob || !offsets) return;
          let bad: number[] = [];
          for (let i = 0; i < offsets.length; i++) {
            const raw = await readLine(blob, offsets, i);
            try { JSON.parse(raw); } catch { bad.push(i); }
            if (bad.length >= BATCH) { post({ type: 'badLines', indices: bad, done: false }); bad = []; }
          }
          post({ type: 'badLines', indices: bad, done: true });
          break;
        }
      }
    } catch (e) {
      post({ type: 'fatal', message: e instanceof Error ? e.message : String(e) });
    }
  };
}

// Worker shell — excluded from vitest coverage, exercised by e2e.
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function' && !('window' in self)) {
  const route = createRouter((m) => (self as any).postMessage(m));
  (self as any).onmessage = (e: MessageEvent<ToWorker>) => { void route(e.data); };
}
