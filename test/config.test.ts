import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addProjectLocation,
  getConfig,
  initConfig,
  loadConfig,
  saveConfig,
  setChatgptVerified,
  setWorkflowChatgptVerified,
  TUNNEL_ID_PATTERN
} from '../src/main/config.js';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('tunnel id validation', () => {
  it('accepts only the OpenAI tunnel id shape used by Phase 0', () => {
    expect(TUNNEL_ID_PATTERN.test('tunnel_0123456789abcdef0123456789abcdef')).toBe(true);
    expect(TUNNEL_ID_PATTERN.test('tunnel_not-a-real-id')).toBe(false);
  });

  it('stores canonical project locations and invalidates ChatGPT verification when the tunnel changes', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-config-test-'));
    const project = path.join(tempDir, 'Project A');
    await mkdir(project);
    initConfig(tempDir);
    await loadConfig();
    expect(getConfig()).toMatchObject({
      workflowTunnelId: '',
      workflowChatgptVerified: false,
      navigationLayout: 'sidebar',
      sidebarCollapsed: false,
      autoConnectOnLaunch: false,
      keepRunningOnWindowClose: true,
      showMenuBarIcon: true,
      launchAtLogin: false,
      developerMode: false
    });

    await addProjectLocation(project);
    expect(getConfig().projectLocations).toEqual([{ name: 'project-a', path: await realpath(project) }]);

    await setChatgptVerified(true);
    expect(getConfig().chatgptVerified).toBe(true);

    await saveConfig({
      ...getConfig(),
      tunnelId: 'tunnel_0123456789abcdef0123456789abcdef',
      language: 'zh-CN',
      autoConnectOnLaunch: true,
      developerMode: true
    });
    expect(getConfig().chatgptVerified).toBe(false);
    await loadConfig();
    expect(getConfig().language).toBe('zh-CN');
    expect(getConfig().autoConnectOnLaunch).toBe(true);
    expect(getConfig().developerMode).toBe(true);
  });

  it('migrates the old Workflow tunnel into the one canonical product tunnel', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-config-test-'));
    initConfig(tempDir);
    await loadConfig();
    const rawId = 'tunnel_0123456789abcdef0123456789abcdef';
    const workflowId = 'tunnel_fedcba9876543210fedcba9876543210';
    await saveConfig({ ...getConfig(), tunnelId: rawId, workflowTunnelId: workflowId });
    await setWorkflowChatgptVerified(true);
    expect(getConfig()).toMatchObject({
      tunnelId: workflowId,
      workflowTunnelId: workflowId,
      chatgptVerified: true,
      workflowChatgptVerified: true
    });

    const replacement = 'tunnel_11111111111111111111111111111111';
    await saveConfig({ ...getConfig(), tunnelId: replacement, workflowTunnelId: replacement });
    expect(getConfig()).toMatchObject({
      tunnelId: replacement,
      workflowTunnelId: replacement,
      chatgptVerified: false,
      workflowChatgptVerified: false
    });

    await setChatgptVerified(true);
    const oneFieldReplacement = 'tunnel_22222222222222222222222222222222';
    await saveConfig({ ...getConfig(), tunnelId: oneFieldReplacement });
    expect(getConfig()).toMatchObject({
      tunnelId: oneFieldReplacement,
      workflowTunnelId: oneFieldReplacement,
      chatgptVerified: false,
      workflowChatgptVerified: false
    });

    await expect(saveConfig({
      ...getConfig(),
      tunnelId: 'tunnel_33333333333333333333333333333333',
      workflowTunnelId: 'tunnel_44444444444444444444444444444444'
    })).rejects.toThrow('Only one product Tunnel ID');
  });

  it('drops the legacy tunnel-client path override from persisted config', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-config-test-'));
    initConfig(tempDir);
    await writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
      tunnelId: '',
      tunnelClientPath: '/tmp/untrusted-tunnel-client',
      projectLocations: [],
      language: 'system'
    }));

    await loadConfig();
    expect(getConfig().navigationLayout).toBe('sidebar');
    expect('tunnelClientPath' in getConfig()).toBe(false);
    expect(JSON.parse(await readFile(path.join(tempDir, 'config.json'), 'utf8'))).not.toHaveProperty('tunnelClientPath');
  });

  it('defaults invalid navigation layouts to sidebar and still persists the migration topbar mode', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-config-test-'));
    initConfig(tempDir);
    await writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
      projectLocations: [],
      navigationLayout: 'invalid'
    }));

    await loadConfig();
    expect(getConfig().navigationLayout).toBe('sidebar');

    await saveConfig({ ...getConfig(), navigationLayout: 'topbar' });
    await loadConfig();
    expect(getConfig().navigationLayout).toBe('topbar');
  });

  it('defaults legacy sidebar collapse state to expanded and persists collapse independently of layout', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-config-test-'));
    initConfig(tempDir);
    await writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
      projectLocations: [],
      navigationLayout: 'sidebar'
    }));

    await loadConfig();
    expect(getConfig().sidebarCollapsed).toBe(false);

    await saveConfig({ ...getConfig(), sidebarCollapsed: true });
    await loadConfig();
    expect(getConfig()).toMatchObject({ navigationLayout: 'sidebar', sidebarCollapsed: true });

    await saveConfig({ ...getConfig(), navigationLayout: 'topbar' });
    await loadConfig();
    expect(getConfig()).toMatchObject({ navigationLayout: 'topbar', sidebarCollapsed: true });
  });
});
