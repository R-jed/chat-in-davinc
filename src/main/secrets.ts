import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { logWarn } from './log.js';

export type TunnelApiKeyStorageState = 'missing' | 'available' | 'unavailable';

interface SecretStore {
  openaiTunnelApiKey: string | null;
  cosBrowserBridgeToken: string | null;
}

const FILE_NAME = 'secrets.bin';
let secretPath = '';
let cache: SecretStore | undefined;
let storageState: TunnelApiKeyStorageState | undefined;
let loadGeneration = 0;
let loadInFlight: Promise<SecretStore | null> | null = null;
let rotationPending = false;
let mutationQueue: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(operation);
  mutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function initSecrets(userData: string): void {
  secretPath = path.join(userData, FILE_NAME);
  cache = undefined;
  storageState = undefined;
  rotationPending = false;
  loadGeneration += 1;
  loadInFlight = null;
}

export async function secureStorageAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    return false;
  }
}

function emptyStore(): SecretStore {
  return { openaiTunnelApiKey: null, cosBrowserBridgeToken: null };
}

function parseSecretStore(json: string): SecretStore {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored credential payload is not an object');
  }
  const record = parsed as Record<string, unknown>;
  const key = record['openaiTunnelApiKey'];
  const bridge = record['cosBrowserBridgeToken'];
  if (key !== undefined && key !== '' && typeof key !== 'string') {
    throw new Error('Stored tunnel API key is not a string');
  }
  if (bridge !== undefined && bridge !== '' && typeof bridge !== 'string') {
    throw new Error('Stored browser bridge token is not a string');
  }
  return {
    openaiTunnelApiKey: typeof key === 'string' && key ? key : null,
    cosBrowserBridgeToken: typeof bridge === 'string' && bridge ? bridge : null
  };
}

async function writeEncrypted(value: SecretStore): Promise<void> {
  if (!(await secureStorageAvailable())) {
    throw new Error('macOS Keychain-backed secure storage is unavailable');
  }
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({
    openaiTunnelApiKey: value.openaiTunnelApiKey ?? '',
    cosBrowserBridgeToken: value.cosBrowserBridgeToken ?? ''
  }));
  await fs.mkdir(path.dirname(secretPath), { recursive: true });
  const tmp = `${secretPath}.tmp`;
  await fs.writeFile(tmp, encrypted, { mode: 0o600 });
  await fs.rename(tmp, secretPath);
  cache = { ...value };
  storageState = value.openaiTunnelApiKey ? 'available' : 'missing';
  rotationPending = false;
}

async function rotateIfNeeded(): Promise<void> {
  if (!rotationPending || cache === undefined) return;
  await enqueue(async () => {
    if (!rotationPending || cache === undefined) return;
    try {
      await writeEncrypted(cache);
    } catch (err) {
      logWarn(`Stored tunnel credential could not be re-encrypted with the current Keychain key: ${(err as Error).message}`);
    }
  });
}

async function loadStore(): Promise<SecretStore | null> {
  const generation = loadGeneration;
  if (!(await secureStorageAvailable())) {
    try {
      await fs.access(secretPath);
      storageState = 'unavailable';
    } catch {
      storageState = 'missing';
    }
    return null;
  }

  try {
    const encrypted = await fs.readFile(secretPath);
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    const value = parseSecretStore(decrypted.result);
    if (generation !== loadGeneration) return cache ? { ...cache } : null;
    cache = value;
    storageState = value.openaiTunnelApiKey ? 'available' : 'missing';
    rotationPending = decrypted.shouldReEncrypt;
  } catch (err) {
    if (generation !== loadGeneration) return cache ? { ...cache } : null;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = emptyStore();
      storageState = 'missing';
      rotationPending = false;
    } else {
      // Decryption failure is not authoritative evidence that no credential exists.
      // Keep the ciphertext untouched, keep cache unresolved, and retry on the next read.
      cache = undefined;
      storageState = 'unavailable';
      rotationPending = false;
      logWarn('Stored tunnel credential is temporarily unavailable; the encrypted file was left untouched');
      return null;
    }
  }

  return cache ? { ...cache } : null;
}

async function readStore(): Promise<SecretStore | null> {
  if (cache !== undefined) return { ...cache };
  if (loadInFlight) return loadInFlight;
  const load = loadStore();
  loadInFlight = load;
  try {
    return await load;
  } finally {
    if (loadInFlight === load) loadInFlight = null;
  }
}

export async function getTunnelApiKey(): Promise<string | null> {
  const value = await readStore();
  await rotateIfNeeded();
  return value?.openaiTunnelApiKey ?? null;
}

/** The stored credential is a standard OpenAI API key shared by Tunnel and the local Agent. */
export const getOpenAiApiKey = getTunnelApiKey;

export async function hasTunnelApiKey(): Promise<boolean> {
  return (await getTunnelApiKey()) !== null;
}

export async function getTunnelApiKeySuffix(): Promise<string | null> {
  const value = await getTunnelApiKey();
  return value && value.length >= 4 ? value.slice(-4) : null;
}

export async function getTunnelApiKeyStorageState(): Promise<TunnelApiKeyStorageState> {
  await readStore();
  return storageState ?? 'missing';
}

/** Pairing bearer for the CID-owned COS browser companion. Never exposed to renderer code. */
export async function getCosBrowserBridgeToken(): Promise<string | null> {
  const value = await readStore();
  await rotateIfNeeded();
  return value?.cosBrowserBridgeToken ?? null;
}

export function setCosBrowserBridgeToken(value: string | null): Promise<void> {
  return enqueue(async () => {
    if (!(await secureStorageAvailable())) {
      throw new Error('macOS Keychain-backed secure storage is unavailable');
    }
    if (cache === undefined) {
      await readStore();
      if (storageState === 'unavailable' || cache === undefined) {
        throw new Error('Stored credentials are temporarily unavailable');
      }
    }
    const next = { ...(cache ?? emptyStore()), cosBrowserBridgeToken: value?.trim() || null };
    if (!next.openaiTunnelApiKey && !next.cosBrowserBridgeToken) {
      loadGeneration += 1;
      await fs.rm(secretPath, { force: true });
      cache = emptyStore();
      storageState = 'missing';
      rotationPending = false;
      return;
    }
    await writeEncrypted(next);
  });
}

export function setTunnelApiKey(value: string): Promise<void> {
  return enqueue(async () => {
    const trimmed = value.trim();
    if (!(await secureStorageAvailable())) {
      throw new Error('macOS Keychain-backed secure storage is unavailable');
    }

    if (trimmed === '') {
      loadGeneration += 1;
      cache = undefined;
      storageState = undefined;
      rotationPending = false;
      const current = await readStore();
      if (!current?.cosBrowserBridgeToken) {
        loadGeneration += 1;
        cache = undefined;
        await fs.rm(secretPath, { force: true });
        cache = emptyStore();
        storageState = 'missing';
        rotationPending = false;
        return;
      }
      await writeEncrypted({ ...current, openaiTunnelApiKey: null });
      return;
    }

    // If an encrypted blob exists but cannot currently be decrypted, do not overwrite it
    // with a replacement credential. That would destroy a credential that may only be
    // temporarily inaccessible because Keychain/provider initialization is incomplete.
    try {
      await fs.access(secretPath);
      if (cache === undefined) {
        await readStore();
        if (storageState === 'unavailable') {
          throw new Error('Stored tunnel credential is temporarily unavailable');
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const current = cache ?? emptyStore();
    await writeEncrypted({ ...current, openaiTunnelApiKey: trimmed });
  });
}

export function resetSecretsCacheForTests(): void {
  loadGeneration += 1;
  cache = undefined;
  storageState = undefined;
  rotationPending = false;
  loadInFlight = null;
}
