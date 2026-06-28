import type { ConsoleLine } from '@shared/contracts/console';

export type ConsoleLineInput = Omit<ConsoleLine, 'id' | 'timestamp'>;

type ConsoleBufferOptions = {
  limit: number;
  now?: () => number;
};

export class ConsoleBuffer {
  private readonly limit: number;
  private readonly now: () => number;
  private lines: ConsoleLine[] = [];
  private pending: ConsoleLine[] = [];
  private nextId = 0;
  private droppedCount = 0;

  constructor(options: ConsoleBufferOptions) {
    this.limit = options.limit;
    this.now = options.now ?? Date.now;
  }

  getLines(): ConsoleLine[] {
    return this.lines.slice();
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  append(inputs: ConsoleLineInput[]): ConsoleLine[] {
    if (inputs.length === 0) return [];
    const timestamp = this.now();
    const appended = inputs.map((input) => ({
      id: this.nextId++,
      timestamp,
      ...input,
    }));
    this.lines.push(...appended);
    this.pending.push(...appended);
    this.trimOverflow();
    return appended;
  }

  copyAll(): string {
    return this.lines.map((line) => line.message).join('\n');
  }

  consumePending(): ConsoleLine[] {
    const batch = this.pending;
    this.pending = [];
    return batch;
  }

  clearPending(): void {
    this.pending = [];
  }

  clear(): void {
    this.lines = [];
    this.pending = [];
    this.droppedCount = 0;
  }

  private trimOverflow(): void {
    if (this.lines.length <= this.limit) return;
    const overflow = this.lines.length - this.limit;
    this.lines.splice(0, overflow);
    this.droppedCount += overflow;
    this.dropPendingBelow(this.lines[0]?.id ?? 0);
  }

  // Ids are monotonic, so pending is sorted; dropping the leading evicted run
  // keeps consumePending a subset of getLines.
  private dropPendingBelow(minRetainedId: number): void {
    let cut = 0;
    while (cut < this.pending.length) {
      const line = this.pending[cut];
      if (!line || line.id >= minRetainedId) break;
      cut++;
    }
    if (cut > 0) this.pending.splice(0, cut);
  }
}
