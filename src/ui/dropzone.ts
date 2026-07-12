export function initDropzone(
  el: HTMLElement,
  demoBtn: HTMLElement,
  onBlob: (blob: Blob, name: string) => void,
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.jsonl,.ndjson,.json,.txt';
  input.hidden = true;
  el.appendChild(input);

  el.addEventListener('click', () => input.click());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onBlob(f, f.name);
  });

  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  for (const ev of ['dragenter', 'dragover', 'dragleave', 'drop']) document.addEventListener(ev, stop);
  document.addEventListener('dragover', () => el.classList.add('dragging'));
  document.addEventListener('dragleave', () => el.classList.remove('dragging'));
  document.addEventListener('drop', (e) => {
    el.classList.remove('dragging');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) onBlob(f, f.name);
  });

  document.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text');
    if (text && text.trim()) onBlob(new Blob([text]), 'pasted.jsonl');
  });

  demoBtn.addEventListener('click', async () => {
    const r = await fetch('/demo.jsonl');
    onBlob(await r.blob(), 'demo.jsonl');
  });
}
