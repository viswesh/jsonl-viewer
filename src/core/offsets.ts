/** Growable store of line-start byte offsets. Float64 is exact for ints < 2^53. */
export class OffsetIndex {
  static readonly MAX_LINES = 50_000_000;
  private buf: Float64Array;
  private count = 0;
  private fileSize = 0;

  constructor(initialCapacity = 1 << 16) {
    this.buf = new Float64Array(initialCapacity);
  }

  push(start: number): void {
    if (this.count >= OffsetIndex.MAX_LINES) throw new RangeError('file too large');
    if (this.count === this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.count++] = start;
  }

  setFileSize(n: number): void { this.fileSize = n; }
  get length(): number { return this.count; }
  start(i: number): number { return this.buf[i]!; }

  /** Exclusive end of line i's content (newline excluded). */
  end(i: number): number {
    return i + 1 < this.count ? this.buf[i + 1]! - 1 : this.fileSize;
  }
}
