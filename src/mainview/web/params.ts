// URL parameters for web mode (/web.html). Everything is optional:
//   ?backend=fixture|live   backend kind (default fixture; live lands in M4)
//   &fixture=<id>           fixture scenario id (default 'basic')
//   &style=split|unified    initial diff style (overrides fixture config)
//   &ws=0|1                 initial ignore-whitespace (overrides fixture config)
//   &file=<path>            select this file once the model loads
//   &delay=<ms>             artificial latency per backend call (loading states)
//   &bridge=<ws url>        live backend socket (default ws://localhost:5178)

import type { DiffStyle } from '../store';

export interface WebParams {
  backend: 'fixture' | 'live';
  fixture: string;
  style?: DiffStyle;
  ignoreWhitespace?: boolean;
  file?: string;
  delay: number;
  bridge: string;
}

export function parseWebParams(search: string): WebParams {
  const params = new URLSearchParams(search);
  const style = params.get('style');
  const ws = params.get('ws');
  const delay = Number(params.get('delay') ?? '0');
  return {
    backend: params.get('backend') === 'live' ? 'live' : 'fixture',
    fixture: params.get('fixture') ?? 'basic',
    style: style === 'split' || style === 'unified' ? style : undefined,
    ignoreWhitespace: ws === null ? undefined : ws === '1',
    file: params.get('file') ?? undefined,
    delay: Number.isFinite(delay) && delay > 0 ? delay : 0,
    bridge: params.get('bridge') ?? 'ws://localhost:5178',
  };
}
