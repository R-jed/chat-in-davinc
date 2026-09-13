import path from 'node:path';
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { getConfig, initConfig, loadConfig, productTunnelId, TUNNEL_ID_PATTERN } from './config.js';
import { buildState, registerIpc } from './ipc.js';
import { initLog, logError, logInfo, logWarn, onLog } from './log.js';
import { RESOLVE_MCP_PATH } from './resolve.js';
import { getTunnelApiKey, initSecrets } from './secrets.js';
import { terminateAllOwnedProcessTrees } from './process.js';
import {
  getTunnelStatus,
  locateTunnelClient,
  onTunnelStatus
} from './tunnel.js';
import type { ResolveProbe } from '../shared/types.js';
import { resolveUiLanguage } from '../shared/i18n.js';
import {
  createWindowActivationGate,
  registerNativeWindowActivation,
  shouldBeginAppBootstrap
} from './window-lifecycle.js';
import { runShutdownSequence } from './shutdown.js';
import { trayGuidArgsForPlatform, trayImageSpec } from './tray-image.js';
import { connectResolveConnection, disconnectResolveConnection, initializeResolveWorkflowEngine, probeResolveConnection, shutdownResolveConnection } from './connection.js';
import { closeWorkflowLedger, initWorkflowLedger } from './workflow-ledger.js';
import { flushDurable, initDurableStore } from './durable.js';
import { restoreLegacyAgentMigrationStore } from './legacy-agent-migration.js';
import { startCosProductHost, stopCosProductHost } from '../cos-host/index.js';
import { initSystemSpineRuntime, shutdownSystemSpineRuntime } from './system-spine.js';

const PRODUCT_NAME = 'Chat in DaVinci';

app.setName(PRODUCT_NAME);
app.setPath('userData', path.join(app.getPath('appData'), PRODUCT_NAME));

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shutdownStarted = false;
let shutdownComplete = false;
let cachedResolve: ResolveProbe = {
  installed: false,
  mcpPath: RESOLVE_MCP_PATH,
  serverName: null,
  serverVersion: null,
  protocolVersion: null,
  tools: [],
  running: null,
  reachable: false,
  detail: 'ResolveMCP has not been probed yet.'
};

function createWindow(): void {
  const macWindowChrome = process.platform === 'darwin'
    ? {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 12, y: 10 }
      }
    : {};
  window = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 760,
    minHeight: 620,
    title: PRODUCT_NAME,
    backgroundColor: '#111111',
    ...macWindowChrome,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setZoomFactor(1);
  window.webContents.on('before-input-event', (event, input) => {
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    if (!modifier || input.type !== 'keyDown') return;
    const key = input.key;
    if (key !== '+' && key !== '=' && key !== '-' && key !== '0') return;
    event.preventDefault();
    const current = getWindowZoomPercent();
    if (key === '0') setWindowZoomPercent(100);
    else if (key === '-' ) setWindowZoomPercent(current - 10);
    else setWindowZoomPercent(current + 10);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.once('did-finish-load', () => {
    window?.webContents.on('will-navigate', (event) => event.preventDefault());
  });
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window?.setTitle(PRODUCT_NAME);
  });
  window.on('close', (event) => {
    if (quitting || shutdownStarted) return;
    if (getConfig().keepRunningOnWindowClose) {
      event.preventDefault();
      window?.hide();
      if (process.platform === 'darwin' && getConfig().showMenuBarIcon) app.dock?.hide();
      return;
    }
    event.preventDefault();
    app.quit();
  });
  window.on('closed', () => { window = null; });
}

function getWindowZoomPercent(): number {
  if (!window || window.isDestroyed()) return 100;
  return Math.round(window.webContents.getZoomFactor() * 100);
}

function setWindowZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) throw new Error('Invalid zoom percentage');
  const next = Math.max(50, Math.min(200, Math.round(percent / 10) * 10));
  if (!window || window.isDestroyed()) return next;
  window.webContents.setZoomFactor(next / 100);
  window.webContents.send('zoom:changed', next);
  return next;
}

function uiLanguage(): 'en' | 'zh-CN' {
  return resolveUiLanguage(getConfig().language, app.getPreferredSystemLanguages());
}

function text(en: string, zh: string): string { return uiLanguage() === 'zh-CN' ? zh : en; }

function showWindow(): void {
  if (!window || window.isDestroyed()) createWindow();
  if (process.platform === 'darwin') void app.dock?.show();
  window?.show();
  if (window?.isMinimized()) window.restore();
  window?.focus();
}

const windowActivation = createWindowActivationGate(showWindow);

function trayIcon(running: boolean): Electron.NativeImage {
  const spec = trayImageSpec(process.platform, running);
  const [base, retina] = spec.representations;
  const image = nativeImage.createFromBuffer(base.png, { scaleFactor: base.scaleFactor });
  image.addRepresentation({ scaleFactor: retina.scaleFactor, buffer: retina.png });
  if (spec.template) image.setTemplateImage(true);
  return image;
}

function tunnelStatusText(): string {
  const state = getTunnelStatus().state;
  if (state === 'error' || state === 'offline') return text('Needs attention', '需要处理');
  if (state === 'connected') return text('Connected', '已连接');
  if (state === 'starting') return text('Connecting…', '正在连接…');
  return text('Disconnected', '已断开');
}

async function connectConfiguredTunnel(): Promise<void> {
  const config = getConfig();
  if (!TUNNEL_ID_PATTERN.test(productTunnelId(config))) throw new Error('Tunnel setup is incomplete');
  const key = await getTunnelApiKey();
  const binary = await locateTunnelClient();
  if (!key || !binary) throw new Error('Tunnel setup is incomplete');
  await connectResolveConnection();
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const tunnelState = getTunnelStatus().state;
  const running = tunnelState === 'connected' || tunnelState === 'starting';
  const status = tunnelStatusText();
  tray.setImage(trayIcon(running));
  tray.setToolTip(`${PRODUCT_NAME} · ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: text('Open Chat in DaVinci', '打开 Chat in DaVinci'), click: showWindow },
    {
      label: running ? text('Disconnect', '断开连接') : text('Connect', '连接'),
      click: () => {
        if (running) void disconnectResolveConnection();
        else void connectConfiguredTunnel().catch((err) => logError(`Tray connect failed: ${(err as Error).message}`));
      }
    },
    { type: 'separator' },
    { label: text('Quit', '退出'), click: () => app.quit() }
  ]));
}

async function applyRuntimePreferences(): Promise<void> {
  const config = getConfig();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });

  if (config.showMenuBarIcon) {
    if (!tray) {
      const tunnelState = getTunnelStatus().state;
      const running = tunnelState === 'connected' || tunnelState === 'starting';
      tray = new Tray(trayIcon(running), ...trayGuidArgsForPlatform());
      tray.on('click', showWindow);
    }
    refreshTrayMenu();
  } else if (tray) {
    tray.destroy();
    tray = null;
    if (process.platform === 'darwin') void app.dock?.show();
  }
}

async function autoConnectConfiguredTunnel(): Promise<void> {
  const config = getConfig();
  if (!config.autoConnectOnLaunch) return;
  const configured = TUNNEL_ID_PATTERN.test(productTunnelId(config));
  const tunnelState = getTunnelStatus().state;
  if (configured && (tunnelState === 'connected' || tunnelState === 'starting')) return;
  if (!configured) {
    logInfo('Auto-connect skipped: tunnel setup is incomplete');
    return;
  }
  try {
    await connectConfiguredTunnel();
  } catch (err) {
    logError(`Auto-connect failed: ${(err as Error).message}`);
  }
}

async function state() {
  return await buildState(cachedResolve);
}

async function refreshResolveState() {
  cachedResolve = await probeResolveConnection();
  return await buildState(cachedResolve);
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  quitting = true;
  app.quit();
}
else {
  app.on('second-instance', windowActivation.request);
  registerNativeWindowActivation(app, windowActivation.request);
  app.on('before-quit', () => {
    quitting = true;
    windowActivation.disable();
  });
  app.on('will-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    tray?.destroy();
    tray = null;
    void runShutdownSequence([
      { name: 'connection', budgetMs: 30_000, run: () => [shutdownResolveConnection()] },
      { name: 'workflow ledger', budgetMs: 2_000, run: () => [closeWorkflowLedger()] },
      { name: 'COS product host', budgetMs: 2_000, run: () => [Promise.resolve(stopCosProductHost())] },
      { name: 'System Spine', budgetMs: 2_000, run: () => [Promise.resolve(shutdownSystemSpineRuntime())] },
      { name: 'durable state', budgetMs: 2_000, run: () => [flushDurable()] },
      { name: 'owned processes', budgetMs: 2_000, run: () => [terminateAllOwnedProcessTrees()] }
    ], {
      info: logInfo,
      warn: logWarn,
      error: logError,
      exit: () => {
        shutdownComplete = true;
        app.exit(0);
        // A synchronous AppleEvent quit can keep Electron alive while its sender waits for a
        // reply even after app.exit() has been requested. Our owned work is already drained at
        // this point, so keep a short process-level fuse as the final lifecycle backstop.
        setTimeout(() => process.exit(0), 250);
      }
    });
  });

  void app.whenReady().then(async () => {
    if (!shouldBeginAppBootstrap(lock, quitting)) return;
    const userData = app.getPath('userData');
    initConfig(userData);
    initSecrets(userData);
    initLog(path.join(userData, 'activity.log'));
    initDurableStore(userData);
    await initSystemSpineRuntime();
    // COS is the upper product/runtime host. CID's pre-COS Agent session store below is
    // migration compatibility for the current renderer only and is not allowed to become a
    // competing Session/Turn/Goal authority.
    await startCosProductHost();
    await loadConfig();
    await restoreLegacyAgentMigrationStore(userData);
    await initWorkflowLedger(userData);
    initializeResolveWorkflowEngine();
    registerIpc(state, refreshResolveState, applyRuntimePreferences, getWindowZoomPercent, setWindowZoomPercent, (event) => {
      if (!window || window.isDestroyed()) return false;
      return event.sender === window.webContents
        && event.senderFrame !== null
        && event.senderFrame.parent === null
        && event.senderFrame.url === window.webContents.getURL();
    });
    cachedResolve = await probeResolveConnection();
    if (quitting || windowActivation.isDisabled()) return;
    createWindow();
    windowActivation.enable();
    const push = async (): Promise<void> => {
      if (!window || window.isDestroyed()) return;
      window.webContents.send('state:changed', await buildState(cachedResolve));
    };
    onTunnelStatus(() => { refreshTrayMenu(); void push(); });
    onLog((entry) => { if (window && !window.isDestroyed()) window.webContents.send('log:entry', entry); });
    await applyRuntimePreferences();
    logInfo(`${PRODUCT_NAME} started`);
    if (getConfig().chatgptVerified) logInfo('ChatGPT verification state restored from saved setup.');
    await autoConnectConfiguredTunnel();
    // TEMPORARY LOCAL ACCEPTANCE ONLY. Removed immediately after the one-shot
    // disposable public product vertical acceptance.
    if (process.env['CID_COLOR_GRADE_VERSION_VERTICAL_ACCEPTANCE'] === '1') {
      try {
        const { runColorGradeVersionVerticalAcceptance } = await import('./color-grade-version-vertical-acceptance.js');
        const result = await runColorGradeVersionVerticalAcceptance();
        logInfo(`COLOR_GRADE_VERSION_VERTICAL_ACCEPTANCE ${JSON.stringify(result)}`);
      } catch (error) {
        logError(`COLOR_GRADE_VERSION_VERTICAL_ACCEPTANCE_FAILED ${(error as Error).message}`);
      } finally {
        app.quit();
      }
    }
  }).catch((err) => {
    logError(`Startup failed: ${(err as Error).message}`);
    app.quit();
  });
}
