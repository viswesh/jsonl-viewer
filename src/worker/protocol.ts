// main → worker
export type ToWorker =
  | { type: 'load'; blob: Blob }
  | { type: 'getLines'; from: number; to: number; reqId: number }   // previews (truncated)
  | { type: 'getLine'; index: number; reqId: number }               // full text
  | { type: 'search'; query: string; searchId: number }
  | { type: 'validate' };

// worker → main
export type FromWorker =
  | { type: 'indexProgress'; lines: number; bytes: number; totalBytes: number }
  | { type: 'indexed'; lineCount: number; fileSize: number }
  | { type: 'lines'; reqId: number; from: number; previews: string[] }
  | { type: 'line'; reqId: number; index: number; text: string }
  | { type: 'searchHits'; searchId: number; hits: number[]; done: boolean; scanned: number; total: number }
  | { type: 'badLines'; indices: number[]; done: boolean }
  | { type: 'fatal'; message: string };
