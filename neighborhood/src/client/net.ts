import type { C2S, S2C } from '../shared/protocol';

/** What the game needs from a transport: a WebSocket to the real server, or the in-page host used by the demo artifact. */
export interface NetLike {
  rtt: number;
  onMessage: (m: S2C) => void;
  onClose: () => void;
  connect(): Promise<void>;
  send(m: C2S): void;
  close(): void;
}

export class Net implements NetLike {
  private ws: WebSocket | null = null;
  rtt = 0;
  private pingTimer = 0;
  onMessage: (m: S2C) => void = () => {};
  onClose: () => void = () => {};

  static url() {
    const env = import.meta.env?.VITE_WS_URL as string | undefined;
    return env || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(Net.url());
      this.ws = ws;
      const fail = setTimeout(() => { reject(new Error('timeout')); ws.close(); }, 7000);
      ws.onopen = () => { clearTimeout(fail); resolve(); };
      ws.onerror = () => { clearTimeout(fail); reject(new Error('Could not reach the neighborhood server')); };
      ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
      ws.onclose = () => { clearInterval(this.pingTimer); this.onClose(); };
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    });
  }
  send(m: C2S) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.ws?.close(); }
}
