import { OffsetIndex } from '../core/offsets';

export interface IndexResult { offsets: OffsetIndex; lineCount: number; fileSize: number }

const NL = 0x0a;

/** Stream the blob, recording the start offset of every non-empty line. */
export async function indexBlob(
  blob: Blob,
  onProgress?: (lines: number, bytes: number) => void,
): Promise<IndexResult> {
  const offsets = new OffsetIndex();
  const reader = blob.stream().getReader();
  let pos = 0;            // absolute byte position
  let lineStart = 0;      // start of current line
  let lineHasBytes = false; // current line has at least one non-CR byte
  let sinceProgress = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) {
      const byte = value[i]!;
      if (byte === NL) {
        if (lineHasBytes) offsets.push(lineStart);
        lineStart = pos + i + 1;
        lineHasBytes = false;
      } else if (byte !== 0x0d) {
        lineHasBytes = true;
      }
    }
    pos += value.length;
    sinceProgress += value.length;
    if (onProgress && sinceProgress >= 4 << 20) { // every ~4MB
      onProgress(offsets.length, pos);
      sinceProgress = 0;
    }
  }
  if (lineHasBytes) offsets.push(lineStart); // last line, no trailing \n
  offsets.setFileSize(blob.size);
  onProgress?.(offsets.length, pos);
  return { offsets, lineCount: offsets.length, fileSize: blob.size };
}

const decoder = new TextDecoder(); // fatal:false replaces invalid sequences

/** Read + decode line i. Trims \r, strips BOM on line 0, truncates to maxBytes if given. */
export async function readLine(
  blob: Blob, offsets: OffsetIndex, i: number, maxBytes?: number,
): Promise<string> {
  const start = offsets.start(i);
  let end = offsets.end(i);
  if (maxBytes !== undefined && end - start > maxBytes) end = start + maxBytes;
  const buf = new Uint8Array(await blob.slice(start, end).arrayBuffer());
  let s = decoder.decode(buf);
  if (i === 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.endsWith('\n')) s = s.slice(0, -1);
  if (s.endsWith('\r')) s = s.slice(0, -1);
  return s;
}
