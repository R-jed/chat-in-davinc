import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value, 'utf8')),
    decryptStringAsync: vi.fn(async (buffer: Buffer) => ({
      result: buffer.toString('utf8'),
      shouldReEncrypt: false
    }))
  }
}));

const {
  getCosBrowserBridgeToken,
  getTunnelApiKey,
  getTunnelApiKeyStorageState,
  getTunnelApiKeySuffix,
  initSecrets,
  resetSecretsCacheForTests,
  setCosBrowserBridgeToken,
  setTunnelApiKey
} = await import('../src/main/secrets.js');
const { safeStorage } = await import('electron');

let dir = '';

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cid-secrets-'));
  initSecrets(dir);
  vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
  vi.mocked(safeStorage.encryptStringAsync).mockImplementation(async (value) => Buffer.from(value, 'utf8'));
  vi.mocked(safeStorage.decryptStringAsync).mockImplementation(async (buffer) => ({
    result: buffer.toString('utf8'),
    shouldReEncrypt: false
  }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('tunnel API key storage', () => {
  it('persists the key, exposes only its suffix to UI callers, and reloads from disk', async () => {
    await setTunnelApiKey('sk-example-secret-ABCD');
    expect(await getTunnelApiKeySuffix()).toBe('ABCD');
    expect(await getTunnelApiKeyStorageState()).toBe('available');

    resetSecretsCacheForTests();
    expect(await getTunnelApiKey()).toBe('sk-example-secret-ABCD');
    expect(await getTunnelApiKeySuffix()).toBe('ABCD');
  });

  it('keeps unreadable ciphertext untouched and reports temporarily unavailable instead of missing', async () => {
    await setTunnelApiKey('sk-before-keychain-race-WXYZ');
    const file = path.join(dir, 'secrets.bin');
    const before = await fs.readFile(file);
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.decryptStringAsync).mockRejectedValue(new Error('Keychain temporarily unavailable'));

    expect(await getTunnelApiKey()).toBeNull();
    expect(await getTunnelApiKeyStorageState()).toBe('unavailable');
    await expect(setTunnelApiKey('sk-must-not-overwrite-1234')).rejects.toThrow(/temporarily unavailable/i);
    expect(await fs.readFile(file)).toEqual(before);
  });

  it('retries a temporarily unavailable decrypt and reseals when Electron requests key rotation', async () => {
    await setTunnelApiKey('sk-rotating-key-5678');
    resetSecretsCacheForTests();
    vi.mocked(safeStorage.encryptStringAsync).mockClear();
    vi.mocked(safeStorage.decryptStringAsync)
      .mockRejectedValueOnce(new Error('provider starting'))
      .mockImplementationOnce(async (buffer) => ({
        result: buffer.toString('utf8'),
        shouldReEncrypt: true
      }));

    expect(await getTunnelApiKey()).toBeNull();
    expect(await getTunnelApiKeyStorageState()).toBe('available');
    expect(await getTunnelApiKey()).toBe('sk-rotating-key-5678');
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledTimes(1);

    resetSecretsCacheForTests();
    expect(await getTunnelApiKey()).toBe('sk-rotating-key-5678');
  });

  it('removes the encrypted file only on an explicit empty-key mutation', async () => {
    await setTunnelApiKey('sk-delete-me-9999');
    const file = path.join(dir, 'secrets.bin');
    expect(await fs.stat(file)).toBeTruthy();
    await setTunnelApiKey('');
    await expect(fs.access(file)).rejects.toBeDefined();
    expect(await getTunnelApiKeyStorageState()).toBe('missing');
  });

  it('persists the browser companion bearer without exposing or overwriting the tunnel key', async () => {
    await setTunnelApiKey('sk-shared-store-ABCD');
    await setCosBrowserBridgeToken('bridge-token-123');
    resetSecretsCacheForTests();

    expect(await getCosBrowserBridgeToken()).toBe('bridge-token-123');
    expect(await getTunnelApiKey()).toBe('sk-shared-store-ABCD');

    await setCosBrowserBridgeToken(null);
    resetSecretsCacheForTests();
    expect(await getCosBrowserBridgeToken()).toBeNull();
    expect(await getTunnelApiKey()).toBe('sk-shared-store-ABCD');
  });
});
