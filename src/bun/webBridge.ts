// Dev-only WebSocket bridge: serves the SupervisionRPC handlers as plain JSON
// frames so a regular browser (web mode, ?backend=live) can drive the real
// Bun backend. Localhost-bound; started only by the headless web entry
// (src/bun/web.ts), never by the packaged app.
//
// Protocol: client → {id, method, params}; server → {id, result} or
// {id, error}; pushes are {event, payload} (workingTreeChanged, repoChanged).

import type { ServerWebSocket } from 'bun';
import type { SupervisionRequestHandlers } from './handlers';

export interface WebBridgeOptions {
  port: number;
  handlers: SupervisionRequestHandlers;
}

export interface WebBridge {
  port: number;
  broadcast(event: string, payload?: unknown): void;
  stop(): void;
}

interface RequestFrame {
  id: number;
  method: keyof SupervisionRequestHandlers;
  params?: unknown;
}

export function startWebBridge(options: WebBridgeOptions): WebBridge {
  const sockets = new Set<ServerWebSocket<unknown>>();

  const server = Bun.serve({
    port: options.port,
    hostname: '127.0.0.1',
    fetch(request, srv) {
      const url = new URL(request.url);
      if (url.pathname === '/socket' && srv.upgrade(request)) {
        return;
      }
      return new Response('supervision web bridge', {
        status: 200,
      });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      async message(ws, raw) {
        let frame: RequestFrame;
        try {
          frame = JSON.parse(String(raw)) as RequestFrame;
        } catch {
          return;
        }
        const handler = options.handlers[frame.method] as ((params: unknown) => Promise<unknown>) | undefined;
        if (typeof handler !== 'function') {
          ws.send(
            JSON.stringify({
              id: frame.id,
              error: `Unknown method: ${String(frame.method)}`,
            }),
          );
          return;
        }
        try {
          const result = await handler(frame.params);
          ws.send(
            JSON.stringify({
              id: frame.id,
              result,
            }),
          );
        } catch (error) {
          ws.send(
            JSON.stringify({
              id: frame.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
    },
  });

  return {
    port: options.port,
    broadcast(event, payload) {
      const frame = JSON.stringify({
        event,
        payload,
      });
      for (const ws of sockets) {
        ws.send(frame);
      }
    },
    stop() {
      server.stop(true);
    },
  };
}
