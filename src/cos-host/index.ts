/**
 * Physical upper-runtime host boundary for Chat in DaVinci.
 *
 * COS owns the product runtime above CID. This host now carries the renderer-independent
 * Session/Goal/Loop/Finish/Compact & Resume and Prime/Worker control seams. CID's legacy Agent
 * session/turn/compact stack remains migration-only and cannot substitute for those authorities.
 *
 * CID remains below this boundary and continues to own the single Tunnel/MCP Gateway,
 * ToolKernel/World Model/safety plane and the single ResolveBroker/Scheduler authority.
 */
import { initCosHostRuntime, shutdownCosHostRuntime } from './runtime.js';
import { startCosBrowserBridge, stopCosBrowserBridge } from './browser-bridge.js';

let running = false;

export async function startCosProductHost(): Promise<void> {
  if (running) return;
  await initCosHostRuntime();
  try {
    await startCosBrowserBridge();
    running = true;
  } catch (error) {
    shutdownCosHostRuntime();
    throw error;
  }
}

export async function stopCosProductHost(): Promise<void> {
  await stopCosBrowserBridge();
  shutdownCosHostRuntime();
  running = false;
}

export function cosProductHostRunning(): boolean {
  return running;
}
