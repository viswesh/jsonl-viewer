export function visibleRange(
  scrollTop: number, viewport: number, rowHeight: number, total: number, overscan = 10,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: -1 };
  const first = Math.floor(scrollTop / rowHeight);
  const count = Math.ceil(viewport / rowHeight);
  return {
    from: Math.max(0, first - overscan),
    to: Math.min(total - 1, first + count + overscan - 1),
  };
}

export interface VirtualListOpts {
  container: HTMLElement;
  rowHeight: number;
  render: (index: number, el: HTMLElement) => void;
  onRangeChange?: (from: number, to: number) => void;
}

export class VirtualList {
  private total = 0;
  private spacer: HTMLElement;
  private rows = new Map<number, HTMLElement>();
  private selected: number | null = null;
  private raf = 0;

  constructor(private opts: VirtualListOpts) {
    this.spacer = document.createElement('div');
    this.spacer.style.position = 'relative';
    opts.container.appendChild(this.spacer);
    opts.container.addEventListener('scroll', () => this.schedule());
  }

  private schedule(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.renderWindow());
  }

  setTotal(n: number): void {
    this.total = n;
    this.spacer.style.height = `${n * this.opts.rowHeight}px`;
    this.opts.container.scrollTop = 0;
    this.renderWindow();
  }

  refresh(): void { this.renderWindow(); }

  scrollToIndex(i: number): void {
    const { container, rowHeight } = this.opts;
    const top = i * rowHeight;
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - rowHeight) {
      container.scrollTop = top - container.clientHeight / 2;
    }
    this.renderWindow();
  }

  setSelected(i: number | null): void {
    this.selected = i;
    for (const [idx, el] of this.rows) el.classList.toggle('selected', idx === i);
  }

  private renderWindow(): void {
    const { container, rowHeight, render, onRangeChange } = this.opts;
    const { from, to } = visibleRange(container.scrollTop, container.clientHeight, rowHeight, this.total);
    for (const [idx, el] of this.rows) {
      if (idx < from || idx > to) { el.remove(); this.rows.delete(idx); }
    }
    for (let i = from; i <= to; i++) {
      if (!this.rows.has(i)) {
        const el = document.createElement('div');
        el.className = 'row';
        el.dataset.index = String(i);
        el.style.cssText = `position:absolute;top:${i * rowHeight}px;height:${rowHeight}px;left:0;right:0;`;
        el.classList.toggle('selected', i === this.selected);
        render(i, el);
        this.spacer.appendChild(el);
        this.rows.set(i, el);
      }
    }
    onRangeChange?.(from, to);
  }
}
