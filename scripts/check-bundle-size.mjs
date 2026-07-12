import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// 50KB gzipped budget for all shipped JS (entry + lazy chunks + worker).
// As of task 14: entry ~27.8KB, speed-highlight lazy chunk ~8.5KB, worker
// ~1.8KB gz -> ~38KB total, comfortably under budget. If a future change
// pushes the sum-all total over 50KB, don't just raise the limit: switch
// this gate to counting only the initial-load chunks (entry + its static
// imports + the worker), derived from dist/index.html's <script type=module>
// and <link rel=modulepreload> tags, and exclude lazily-imported chunks
// (e.g. speed-highlight, loaded on demand) since they don't affect first
// paint. Document that change here when it happens.
const LIMIT = 50 * 1024; // 50KB gzipped, JS only
const dir = 'dist/assets';
let total = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const gz = gzipSync(readFileSync(join(dir, f))).length;
  console.log(`${f}: ${(gz / 1024).toFixed(1)}KB gz`);
  total += gz;
}
console.log(`total JS: ${(total / 1024).toFixed(1)}KB gz (limit ${(LIMIT / 1024).toFixed(0)}KB)`);
if (total > LIMIT) {
  console.error('FAIL: bundle exceeds 50KB gzipped');
  process.exit(1);
}
