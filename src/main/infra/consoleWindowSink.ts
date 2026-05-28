import type { BrowserWindow } from 'electron';

export class ConsoleWindowSink {
  private window: BrowserWindow | null = null;

  constructor(private readonly onClosed: () => void) {}

  attach(window: BrowserWindow): void {
    this.window = window;
    window.on('closed', () => {
      if (this.window !== window) return;
      this.window = null;
      this.onClosed();
    });
  }

  hasWindow(): boolean {
    return this.window != null && !this.window.isDestroyed();
  }

  getWindow(): BrowserWindow | null {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window;
  }

  send(channel: string, payload: unknown): void {
    const window = this.getWindow();
    if (!window) return;
    try {
      window.webContents.send(channel, payload);
    } catch {
      /* renderer torn down between checks - drop the push */
    }
  }
}
