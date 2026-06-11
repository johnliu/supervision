// Live web backend: a PlatformBackend over the plain-WS bridge served by
// src/bun/web.ts. Same SupervisionRPC contract and handler code as the
// desktop app — only the transport differs. Dev-only.

import type { PlatformBackend, RepoChangedInfo, SupervisionApi } from '../platform';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 1_000;

export function createLiveBackend(url: string): PlatformBackend {
  let socket: WebSocket | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const sendQueue: string[] = [];

  const treeListeners: Array<() => void> = [];
  const menuListeners: Array<(action: string) => void> = [];
  const repoListeners: Array<(info: RepoChangedInfo) => void> = [];
  void menuListeners; // no native menu in web mode; kept for interface parity

  function connect(): void {
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener('open', () => {
      for (const frame of sendQueue.splice(0)) {
        ws.send(frame);
      }
    });
    ws.addEventListener('message', (event) => {
      let frame: {
        id?: number;
        result?: unknown;
        error?: string;
        event?: string;
        payload?: unknown;
      };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame.id != null) {
        const entry = pending.get(frame.id);
        if (entry) {
          pending.delete(frame.id);
          if (frame.error != null) {
            entry.reject(new Error(frame.error));
          } else {
            entry.resolve(frame.result);
          }
        }
        return;
      }
      if (frame.event === 'workingTreeChanged') {
        for (const cb of treeListeners) {
          cb();
        }
      } else if (frame.event === 'repoChanged') {
        for (const cb of repoListeners) {
          cb(frame.payload as RepoChangedInfo);
        }
      }
    });
    ws.addEventListener('close', () => {
      if (socket === ws) {
        socket = null;
      }
      for (const [, entry] of pending) {
        entry.reject(new Error('web bridge connection closed'));
      }
      pending.clear();
      setTimeout(connect, RECONNECT_DELAY_MS);
    });
    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  connect();

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    const frame = JSON.stringify({
      id,
      method,
      params,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`web bridge request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
      } else {
        sendQueue.push(frame);
      }
    });
  }

  const api = new Proxy({} as SupervisionApi, {
    get(_target, method: string) {
      return (params?: unknown) => request(method, params);
    },
  });

  return {
    api,
    onWorkingTreeChanged: (cb) => treeListeners.push(cb),
    onMenuAction: (cb) => menuListeners.push(cb),
    onRepoChanged: (cb) => repoListeners.push(cb),
  };
}
