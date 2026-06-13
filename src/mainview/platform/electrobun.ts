// Desktop backend: adapts the existing Electrobun RPC layer to the platform
// facade. This module is the ONLY importer of ../rpc — pulling it in evaluates
// `new Electroview(...)` (which requires the Electrobun webview bridge), so
// only the desktop entry (main.tsx) may import this file. The web entry
// installs its own backend and never touches Electrobun code.

import { type PlatformBackend, type SupervisionApi, setPlatform } from '../platform';
import { api, onMenuAction, onRepoChanged, onWorkingTreeChanged, sendMenuState } from '../rpc';

export function initElectrobunPlatform(): void {
  // Electrobun's request proxy has the same call shape as SupervisionApi (the
  // facade type mirrors RPCRequestsProxy); the annotation just pins it.
  const platformApi: SupervisionApi = api;
  const backend: PlatformBackend = {
    api: platformApi,
    onWorkingTreeChanged,
    onMenuAction,
    onRepoChanged,
    sendMenuState,
  };
  setPlatform(backend);
}
