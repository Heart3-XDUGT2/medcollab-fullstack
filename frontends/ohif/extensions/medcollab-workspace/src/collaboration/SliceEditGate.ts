/** Pause a brush's initial mouse events until the server grants all affected CT slices. */
export class SliceEditGate {
  private replaying = false;
  private pending?: { events: MouseEvent[]; target: Element; scope: string; generation: number };
  private generation = 0;
  constructor(private options: {
    scope: (event: MouseEvent) => string[] | null;
    acquire: (ids: string[]) => Promise<void>;
    holds: (ids: string[]) => boolean;
    touch: () => void;
    error: (error: unknown) => void;
  }) {
    document.addEventListener('mousedown', this.down, true);
    document.addEventListener('mousemove', this.capture, true);
    document.addEventListener('mouseup', this.capture, true);
  }
  private down = (event: MouseEvent) => {
    if (this.replaying || event.button !== 0 || this.pending) return;
    const ids = this.options.scope(event);
    if (!ids) return;
    this.options.touch();
    if (this.options.holds(ids)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pending = { events: [event], target: event.target as Element,
      scope: JSON.stringify(ids), generation: this.generation };
    this.pending = pending;
    this.options.acquire(ids).then(() => {
      if (this.pending !== pending || pending.generation !== this.generation) return;
      if (JSON.stringify(this.options.scope(event)) !== pending.scope || !pending.target.isConnected)
        throw new Error('已切换 CT 切片，请在当前切片重新落笔');
      this.pending = undefined;
      this.replaying = true;
      try {
        for (const saved of pending.events) pending.target.dispatchEvent(new MouseEvent(saved.type, {
          bubbles: true, cancelable: true, view: window, button: saved.button, buttons: saved.buttons,
          clientX: saved.clientX, clientY: saved.clientY, ctrlKey: saved.ctrlKey,
          shiftKey: saved.shiftKey, altKey: saved.altKey, metaKey: saved.metaKey,
        }));
      } finally { this.replaying = false; }
    }).catch(error => {
      if (pending.generation !== this.generation) return;
      this.pending = undefined;
      this.options.error(error);
    });
  };
  private capture = (event: MouseEvent) => {
    if (this.replaying) return;
    if (event.buttons === 1) this.options.touch();
    if (!this.pending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Preserve the first stroke while waiting for the HTTP lease, with bounded memory.
    if (this.pending.events.length < 512 || event.type === 'mouseup') this.pending.events.push(event);
  };
  destroy() {
    this.generation++;
    this.pending = undefined;
    document.removeEventListener('mousedown', this.down, true);
    document.removeEventListener('mousemove', this.capture, true);
    document.removeEventListener('mouseup', this.capture, true);
  }
}
