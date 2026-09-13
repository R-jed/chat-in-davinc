import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v0.0.14';
const SHA256 = 'b540493c5bdbcdbb755700c8e2e16597e28b1569e425007e0f73111047bd6a64';
const ASSET = `tunnel-client-${VERSION}-darwin-arm64.zip`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache', 'chat-in-davinci-tunnel');
const zipPath = path.join(cacheDir, ASSET);
const outDir = path.join(root, 'resources', 'tunnel');

async function download() {
  if (existsSync(zipPath)) return;
  const url = `https://github.com/openai/tunnel-client/releases/download/${VERSION}/${ASSET}`;
  const response = await fetch(url, { headers: { 'user-agent': 'chat-in-davinci-build' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`Local test packaging expects darwin-arm64, got ${process.platform}-${process.arch}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await download();
  const actual = createHash('sha256').update(await readFile(zipPath)).digest('hex');
  if (actual !== SHA256) {
    await rm(zipPath, { force: true });
    throw new Error(`Checksum mismatch for ${ASSET}: expected ${SHA256}, got ${actual}`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', outDir], { stdio: 'inherit' });
  const tunnel = path.join(outDir, 'tunnel-client');
  if (!existsSync(tunnel)) throw new Error(`${ASSET} did not contain tunnel-client`);
  await chmod(tunnel, 0o755);
  process.stdout.write(`tunnel-client ${VERSION} darwin-arm64 checksum verified\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
