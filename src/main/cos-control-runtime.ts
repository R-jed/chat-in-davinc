import type {
  CosAgentsInput,
  CosControlCallContext,
  CosControlRuntime,
  CosControlRuntimeDelegate,
  CosSessionFinishInput,
  CosSessionInput
} from './cos-control-tools.js';

/**
 * Stable product-side binding point for the COS-owned control runtime.
 *
 * CID never supplies a fallback implementation here. Exactly one host runtime may own the
 * control surface at a time; missing host slices fail closed until the physical COS module is
 * attached. This keeps legacy CID session/agent stores out of the authority path.
 */
let attachedRuntime: CosControlRuntimeDelegate | null = null;

export function attachCosControlRuntime(runtime: CosControlRuntimeDelegate): void {
  if (attachedRuntime === runtime) return;
  if (attachedRuntime) throw new Error('A COS control runtime owner is already attached');
  if (!runtime.session && !runtime.agents && !runtime.sessionFinish) {
    throw new Error('COS control runtime attachment exposes no control capabilities');
  }
  attachedRuntime = runtime;
}

export function detachCosControlRuntime(runtime: CosControlRuntimeDelegate): boolean {
  if (attachedRuntime !== runtime) return false;
  attachedRuntime = null;
  return true;
}

function requireHandler<K extends keyof CosControlRuntime>(name: K): CosControlRuntime[K] {
  const runtime = attachedRuntime;
  if (!runtime) throw new Error(`COS host runtime is not attached for ${name}`);
  const handler = runtime[name];
  if (!handler) throw new Error(`COS host runtime does not own ${name}; refusing to use a CID fallback`);
  return handler as CosControlRuntime[K];
}

export const cosControlRuntimeBridge: CosControlRuntime = {
  async session(input: CosSessionInput, context: CosControlCallContext) {
    return await requireHandler('session')(input, context);
  },
  async agents(input: CosAgentsInput, context: CosControlCallContext) {
    return await requireHandler('agents')(input, context);
  },
  async sessionFinish(input: CosSessionFinishInput, context: CosControlCallContext) {
    return await requireHandler('sessionFinish')(input, context);
  }
};

export function resetCosControlRuntimeForTests(): void {
  attachedRuntime = null;
}
