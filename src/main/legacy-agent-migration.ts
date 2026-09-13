/**
 * Pre-COS CID Agent session store retained only so the current migration renderer can still
 * display its existing local sessions while the COS renderer/session stack is being rebased.
 *
 * This module is not an upper-runtime authority boundary. New product runtime work belongs in
 * src/cos-host; this store must disappear from startup when the COS session renderer lands.
 */
import { initAgentSessionStore, restoreAgentSessionStore } from './agent-session-store.js';

export async function restoreLegacyAgentMigrationStore(userDataDir: string): Promise<void> {
  initAgentSessionStore(userDataDir);
  await restoreAgentSessionStore();
}
