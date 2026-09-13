/**
 * Status UI, and the one place that answers "where did the stream stop?".
 *
 * Everything this browser observes has to survive three hand-offs before the desktop app
 * has it: this extension reads it off the page, the service worker delivers it, and the
 * app records it into a session for this chat. All three used to fail the same way from
 * here — nothing happens — so "Reaching the app" opens onto those three stages stated
 * separately, and names the one that did not complete.
 *
 * It opens itself when something is wrong and stays shut when nothing is, because a panel
 * that is always expanded is a panel nobody reads.
 */

const $ = (id) => document.getElementById(id);
const RENDER_STREAM_KEY = 'renderStreamEnabled';
const SHOW_TIMES_KEY = 'showStreamTimes';
const POLL_MS = 1500;
const I18N = globalThis.CLF_I18N;
const I18N_FALLBACK_EN = Object.freeze({
    "popup.allCallsMatched": "Every tool call matched end to end.",
    "popup.answering": "answering",
    "popup.appNotRunning": "App not reachable",
    "popup.appUnreachable": "The app is not reachable. Nothing is leaving this browser.",
    "popup.blocked": "blocked",
    "popup.callsUnplaced": "The app could not place {count} {noun} by request id — it fell back to {fallback}.",
    "popup.connect": "Connect",
    "popup.reconnect": "Reconnect",
    "popup.authorizationRevoked": "This browser connection was explicitly disconnected. Choose Reconnect to resume sending data to the app.",
    "popup.revokeConfirm": "Disconnect this browser extension? It will stay disconnected until you choose Reconnect.",
    "popup.connectedPort": "App reachable · Port {port}",
    "popup.connectingPort": "Port {port} · connecting",
    "popup.copied": "copied",
    "popup.copyFailed": "copy failed",
    "popup.deliveredNoSession": "App reachable. Waiting for this chat’s session receipt.",
    "popup.deliveryRejected": "The app rejected the last delivery ({error}).",
    "popup.disconnected": "Disconnected",
    "popup.heldCount": "{count} held",
    "popup.heldInPage": "{count} held in page",
    "popup.detail.app": "app",
    "popup.detail.extension": "extension",
    "popup.detail.chatId": "chat id",
    "popup.detail.appSession": "app session",
    "popup.detail.tab": "tab",
    "popup.detail.ownership": "ownership",
    "popup.detail.recorder": "recorder",
    "popup.detail.turn": "turn",
    "popup.detail.observed": "observed",
    "popup.detail.browser": "in this browser",
    "popup.detail.lastDelivery": "last delivery",
    "popup.detail.delivered": "delivered",
    "popup.detail.pageSends": "page sends",
    "popup.retired": "retired",
    "popup.bound": "bound",
    "popup.unbound": "unbound",
    "popup.notAttached": "not attached",
    "popup.idle": "idle",
    "popup.eventsCalls": "{events} events · {calls} calls",
    "popup.heldTotal": "{held} held · {total} total",
    "popup.failedCount": "{count} failed",
    "popup.port": "port {port}",
    "popup.protocol": "protocol {protocol}",
    "popup.epoch": "epoch {epoch}",
    "popup.run": "run {run}",
    "popup.liveTurn": "{turn} · live",
    "popup.lastDeliveryMeta": "{status} · {events} · {age} ago",
    "popup.ok": "ok",
    "popup.failed": "failed",
    "popup.secondsShort": "{count}s",
    "popup.minutesShort": "{count}m",
    "popup.hoursShort": "{count}h",
    "popup.live": "live",
    "popup.newChat": "new chat",
    "popup.no": "no",
    "popup.noRecord": "no record",
    "popup.noRecorder": "No recorder in this tab. Reload the page.",
    "popup.noneOpen": "none open",
    "popup.noneYet": "none yet",
    "popup.pickedUp": "Picked up",
    "popup.protocolMismatch": "The app and this extension speak different bridge protocols.",
    "popup.protocolMismatchDetails": "App {appVersion} (protocol {appProtocol}) and extension {extensionVersion} (protocol {extensionProtocol}) do not match. In Chrome Developer mode, choose Open extension folder in the app and reload that unpacked extension.",
    "popup.deliveryBlocked": "Delivery is blocked until pairing and protocol compatibility are confirmed.",
    "popup.queuedCount": "{count} queued",
    "popup.queuedRetry": "Queued here. Retrying delivery to the app.",
    "popup.recordingIntoApp": "Recording into the app.",
    "popup.reload": "reload",
    "popup.reloadCompanion": "Reload companion",
    "popup.secureStorageUnavailable": "Secure credential storage is unavailable. Open Chat in DaVinci for setup instructions.",
    "popup.sentToApp": "Sent to app",
    "popup.tabRejected": "The extension is not accepting this tab’s observations ({error}). Reload the ChatGPT tab.",
    "popup.toolCall": "tool call",
    "popup.tool.exec_command": "Run command",
    "popup.tool.write_stdin": "Terminal session",
    "popup.tool.read": "Read files",
    "popup.tool.find": "Search files",
    "popup.tool.view_image": "View image",
    "popup.tool.apply_patch": "Apply changes",
    "popup.tool.session": "Session history",
    "popup.tool.agents": "Coordinate Workers",
    "popup.tool.observe": "Observe desktop",
    "popup.tool.computer": "Use desktop",
    "popup.error.app_not_found": "App not found",
    "popup.error.incompatible_extension": "Incompatible extension",
    "popup.error.disconnected": "Disconnected",
    "popup.error.not_paired": "Not paired",
    "popup.error.unauthorised": "Authentication failed",
    "popup.error.reconnect_unauthorised": "Reconnect authentication failed",
    "popup.error.browser_disconnected": "Browser authorization revoked",
    "popup.error.secure_storage_unavailable": "Secure credential storage unavailable",
    "popup.error.rate_limited": "Too many requests",
    "popup.error.forbidden_origin": "Origin not authorised",
    "popup.error.pair_failed": "Pairing failed",
    "popup.error.timed_out": "App response timed out",
    "popup.chatError": "ChatGPT reported an error. See the conversation for details.",
    "popup.tryAgain": "Try again",
    "popup.versionMismatch": "Version mismatch",
    "popup.waitFirstMessage": "Waiting for the first message.",
    "popup.waiting": "waiting",
    "popup.yes": "yes"
  });
const UI_LANGUAGE_KEY = I18N ? I18N.LANGUAGE_KEY : 'uiLanguage';

let languagePreference = 'system';
let uiLanguage = I18N ? I18N.resolveLanguage(languagePreference) : 'en';

function validLanguagePreference(value) {
  return value === 'system' || value === 'en' || value === 'zh-CN';
}

function refreshLanguage() {
  uiLanguage = I18N ? I18N.resolveLanguage(languagePreference) : 'en';
}

function t(key, params) {
  if (I18N) return I18N.text(uiLanguage, key, params);
  const template = I18N_FALLBACK_EN[key] || key;
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
    params[name] === undefined ? match : String(params[name])
  );
}

function applyLanguage() {
  document.documentElement.lang = uiLanguage;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  const select = $('languageSelect');
  if (select) {
    select.value = languagePreference;
    select.disabled = false;
  }
}

let overwriteEnabled = true;
let showTimes = false;
let latest = { status: null, tab: null };
let openedOnFailure = false;

// ------------------------------------------------------------------ formatting

/** Ids are long and only their ends identify them, so keep both ends rather than one. */
function shorten(value, keep = 6) {
  const text = String(value || '');
  if (text.length <= keep + 5) return text;
  return `${text.slice(0, keep)}…${text.slice(-4)}`;
}

function ago(at) {
  if (!at) return '';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return t('popup.secondsShort', { count: seconds });
  if (seconds < 3600) return t('popup.minutesShort', { count: Math.round(seconds / 60) });
  return t('popup.hoursShort', { count: Math.round(seconds / 3600) });
}

/** One capture row: ok, no, wait or off, plus whatever it wants to say on the right. */
function row(name, state, meta) {
  $(`r-${name}`).className = `row ${state}`;
  const value = $(`d-${name}`);
  value.textContent = meta === null || meta === undefined ? '' : meta;
}

function idRow(name, state, meta, full) {
  row(name, state, meta);
  const value = $(`d-${name}`);
  value.title = full || '';
  value.disabled = !full;
}

function stage(name, state, meta) {
  $(`s-${name}`).className = `stage ${state}`;
  $(`n-${name}`).textContent = meta || '';
}

// -------------------------------------------------------------------- pipeline

/** How the app describes what it placed a call on, in its own words. */
const ATTRIBUTION = {
  request_id: 'popup.attribution.request_id',
  unattributed: 'popup.attribution.unattributed',
  agent: 'popup.attribution.agent',
  turn: 'popup.attribution.turn',
  generation: 'popup.attribution.generation',
  inferred: 'popup.attribution.inferred'
};

function attributionText(value) {
  const key = ATTRIBUTION[value];
  if (key) return t(key);
  return uiLanguage === 'zh-CN' ? t('popup.noRecord') : value || t('popup.noRecord');
}

const TOOL_TEXT = {
  exec_command: 'popup.tool.exec_command',
  write_stdin: 'popup.tool.write_stdin',
  read: 'popup.tool.read',
  find: 'popup.tool.find',
  view_image: 'popup.tool.view_image',
  apply_patch: 'popup.tool.apply_patch',
  session: 'popup.tool.session',
  agents: 'popup.tool.agents',
  observe: 'popup.tool.observe',
  computer: 'popup.tool.computer'
};

function toolText(value) {
  const raw = typeof value === 'string' ? value : '';
  const key = TOOL_TEXT[raw];
  if (key) return t(key);
  // Unknown tool ids are useful diagnostics in English, but are implementation detail rather
  // than user-facing Chinese copy. Keep the exact id on the row's title below instead.
  return uiLanguage === 'zh-CN' ? t('popup.toolCall') : raw || t('popup.toolCall');
}

const ERROR_TEXT = {
  app_not_found: 'popup.error.app_not_found',
  incompatible_extension: 'popup.error.incompatible_extension',
  disconnected: 'popup.error.disconnected',
  not_paired: 'popup.error.not_paired',
  unauthorised: 'popup.error.unauthorised',
  reconnect_unauthorised: 'popup.error.reconnect_unauthorised',
  browser_disconnected: 'popup.error.browser_disconnected',
  secure_storage_unavailable: 'popup.error.secure_storage_unavailable',
  rate_limited: 'popup.error.rate_limited',
  forbidden_origin: 'popup.error.forbidden_origin',
  pair_failed: 'popup.error.pair_failed',
  'the app took too long to answer': 'popup.error.timed_out'
};

function errorText(value) {
  const raw = typeof value === 'string' ? value : '';
  const key = ERROR_TEXT[raw];
  if (key) return t(key);
  return uiLanguage === 'zh-CN' ? t('popup.failed') : raw || t('popup.failed');
}

/**
 * The three stages, from evidence each layer produced independently.
 *
 * Deliberately not one flag set by whoever ran last: "picked up" is the page's own count,
 * "sent to app" is the service worker's delivery log, and "app processed" is the app
 * naming a session for this chat on the feed the page polls. A stage is only green when
 * the layer that owns it said so.
 */
function pipeline(info, ready) {
  const page = info && info.page;
  const sent = info && info.delivery;
  const pending = info ? info.pending : 0;
  const read = page ? page.events : 0;

  if (!info || !info.isChat) return { read: ['off'], sent: ['off'], proc: ['off'], why: ['', ''] };
  if (!info.recorder) {
    return { read: ['failed'], sent: ['off'], proc: ['off'], why: ['bad', t('popup.noRecorder')] };
  }
  if (read === 0) {
    return { read: ['running'], sent: ['off'], proc: ['off'], why: ['', t('popup.waitFirstMessage')] };
  }

  const readStage = ['done', String(read)];
  if (!ready) {
    return {
      read: readStage,
      sent: ['failed', pending ? t('popup.heldCount', { count: pending }) : ''],
      proc: ['off'],
      why: ['bad', t('popup.deliveryBlocked')]
    };
  }
  if (sent && sent.ok === false) {
    return {
      read: readStage,
      sent: ['failed', String(sent.error || 'failed')],
      proc: ['off'],
      why: ['bad', t('popup.deliveryRejected', { error: errorText(sent.error) })]
    };
  }
  // Refused by the extension itself, before anything could be queued for the app. `pending`
  // counts only what the service worker already owns, so a document it is rejecting outright
  // reported nothing pending and this drawer went on to say "Delivered" — which is what it
  // said all through the 2026-08-21 blackout while the tab was reading ChatGPT perfectly and
  // sending none of it. The page is the only layer that knows, so it is the layer that says so.
  if (page.blocked) {
    return {
      read: readStage,
      sent: ['failed', page.queued ? t('popup.heldInPage', { count: page.queued }) : errorText(String(page.blocked))],
      proc: ['off'],
      why: [
        'bad',
        t('popup.tabRejected', { error: errorText(String(page.blocked)) })
      ]
    };
  }
  if (pending > 0) {
    return {
      read: readStage,
      sent: ['running', t('popup.queuedCount', { count: pending })],
      proc: ['off'],
      why: ['', t('popup.queuedRetry')]
    };
  }

  if (!page.session) {
    return {
      read: readStage,
      sent: ['running'],
      proc: ['running'],
      // The worker's delivery counters cover every tab. Only the page's session
      // receipt proves that this particular chat reached the app.
      why: ['', t('popup.deliveredNoSession')]
    };
  }
  const sentStage = ['done', sent && sent.total ? String(sent.total) : ''];

  const calls = Array.isArray(page.trace) ? page.trace : [];
  const placed = calls.filter((call) => call.app === 'request_id').length;
  const missed = calls.filter((call) => call.app && call.app !== 'request_id');
  if (missed.length > 0) {
    return {
      read: readStage,
      sent: sentStage,
      proc: ['failed', `${placed}/${calls.length}`],
      why: [
        'bad',
        t('popup.callsUnplaced', { count: missed.length, noun: missed.length === 1 ? 'call' : 'calls', fallback: attributionText(missed[0].app) })
      ]
    };
  }
  return {
    read: readStage,
    sent: sentStage,
    proc: ['done', calls.length ? `${placed}/${calls.length}` : ''],
    why: ['', calls.length ? t('popup.allCallsMatched') : t('popup.recordingIntoApp')]
  };
}

/** One row per request id: three dots, the tool, the id. Newest first. */
function paintCalls(page) {
  const box = $('calls');
  box.textContent = '';
  const rows = page && Array.isArray(page.trace) ? page.trace.slice(0, 5) : [];
  for (const entry of rows) {
    const line = document.createElement('div');
    line.className = 'call';
    const pips = document.createElement('span');
    pips.className = 'pips';
    for (const state of [
      entry.read ? 'on' : '',
      entry.sent ? 'on' : '',
      entry.app ? (entry.app === 'request_id' ? 'on' : 'bad') : ''
    ]) {
      const pip = document.createElement('span');
      pip.className = `pip ${state}`;
      pips.append(pip);
    }
    const tool = document.createElement('span');
    tool.className = 'tool';
    tool.textContent = toolText(entry.tool);
    tool.title = entry.tool || '';
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = shorten(entry.requestId, 5);
    line.title = `${entry.requestId} — ${t('popup.pickedUp')} ${entry.read ? t('popup.yes') : t('popup.no')} · ${t('popup.sentToApp')} ${entry.sent ? t('popup.yes') : t('popup.no')} · ${t('popup.detail.app')} ${attributionText(entry.app)}`;
    line.append(pips, tool, id);
    box.append(line);
  }
}

// ------------------------------------------------------------------- rendering

function paintHeader(status) {
  const connected = status && status.connected === true;
  const paired = status && status.paired === true;
  const incompatible = connected && status.compatible === false;
  // Disconnected on purpose. This has to say so plainly rather than describing it as a
  // connection that has not finished yet, which is what it looked like back when the next
  // poll would silently undo it.
  const off = status && status.disconnected === true && !paired;
  const ready = connected && paired && status.compatible === true;

  $('pill').className = `pill ${ready ? '' : incompatible ? 'bad' : 'off'}`;
  $('state').textContent = incompatible
    ? t('popup.versionMismatch')
    : off
      ? t('popup.disconnected')
      : !connected
        ? t('popup.appNotRunning')
        : ready
          // Health + pairing prove reachability, not the recorder/command flow.
          ? t('popup.connectedPort', { port: status.port })
          : t('popup.connectingPort', { port: status.port });

  $('retryBtn').hidden = ready || incompatible;
  $('retryBtn').textContent = off ? t('popup.connect') : t('popup.tryAgain');
  $('unpairBtn').hidden = !paired || incompatible;
  return ready;
}

function paintAlert(status, info) {
  const page = info && info.page;
  const incompatible = status && status.connected === true && status.compatible === false;
  const pairError = status && status.pairError;
  const error = page && page.lastError;
  const text = incompatible
    ? t('popup.protocolMismatchDetails', {
        appVersion: status.appVersion || '?',
        appProtocol: status.appProtocol ?? '?',
        extensionVersion: status.extensionVersion || '?',
        extensionProtocol: status.extensionProtocol ?? '?'
      })
    : pairError && pairError.message
      ? uiLanguage === 'zh-CN' ? errorText(pairError.error) : pairError.message
      : pairError && pairError.error === 'secure_storage_unavailable'
        ? t('popup.secureStorageUnavailable')
        : error && Date.now() - error.at < 10 * 60 * 1000
          ? uiLanguage === 'zh-CN' ? t('popup.chatError') : error.text
          : '';
  $('alert').textContent = text;
  $('alert').hidden = !text;
}

function detail(list, term, value, bad) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  if (bad) dd.className = 'bad';
  dd.title = dd.textContent;
  list.append(dt, dd);
}

/**
 * Only what changes the reading of the three stages.
 *
 * An earlier draft of this drawer listed twenty-eight fields, which is a different thing
 * from being informative: nothing in it told you which layer had stopped.
 */
function paintDetails(status, info) {
  if (!$('more').open) return;
  const grid = $('grid');
  grid.textContent = '';
  const page = info && info.page;
  const sent = info && info.delivery;

  detail(
    grid,
    t('popup.detail.app'),
    status ? `v${status.appVersion || '?'} · ${t('popup.port', { port: status.port || '—' })}` : null
  );
  detail(
    grid,
    t('popup.detail.extension'),
    status ? `v${status.extensionVersion} · ${t('popup.protocol', { protocol: status.extensionProtocol })}` : null,
    status && status.compatible === false
  );
  detail(grid, t('popup.detail.chatId'), (info && info.conversationId) || null);
  detail(grid, t('popup.detail.appSession'), (page && page.session) || null, Boolean(page && !page.session));
  detail(
    grid,
    t('popup.detail.tab'),
    info ? `${info.tab} · ${t('popup.epoch', { epoch: info.epoch ?? '—' })}` : null
  );
  detail(
    grid,
    t('popup.detail.ownership'),
    info ? t(info.terminal ? 'popup.retired' : info.bound ? 'popup.bound' : 'popup.unbound') : null,
    Boolean(info && info.terminal)
  );
  detail(
    grid,
    t('popup.detail.recorder'),
    page ? `fiber v${page.recorderVersion} · ${t('popup.run', { run: page.runId })}` : t('popup.notAttached'),
    !page
  );
  detail(
    grid,
    t('popup.detail.turn'),
    page ? (page.generating ? t('popup.liveTurn', { turn: shorten(page.turnId, 8) }) : t('popup.idle')) : null
  );
  detail(
    grid,
    t('popup.detail.observed'),
    page ? t('popup.eventsCalls', { events: page.events, calls: page.calls }) : null
  );
  detail(
    grid,
    t('popup.detail.browser'),
    info ? t('popup.heldTotal', { held: info.pending, total: info.pendingAll }) : null,
    Boolean(info && info.pendingAll)
  );
  detail(
    grid,
    t('popup.detail.lastDelivery'),
    sent && sent.at
      ? t('popup.lastDeliveryMeta', {
          status: sent.ok ? t('popup.ok') : errorText(sent.error),
          events: sent.events,
          age: ago(sent.at)
        })
      : null,
    Boolean(sent && sent.ok === false)
  );
  detail(grid, t('popup.detail.delivered'), sent ? sent.total : null);
  detail(
    grid,
    t('popup.detail.pageSends'),
    page ? `${page.sends} · ${t('popup.failedCount', { count: page.failures })}` : null,
    Boolean(page && page.failures)
  );
}

function paintSnapshot(status, info) {
  const ready = paintHeader(status);
  const isChat = Boolean(info && info.isChat);
  const page = info && info.page;

  row('tab', isChat ? 'ok' : 'off', isChat ? '' : t('popup.noneOpen'));
  row('rec', !isChat ? 'off' : info.recorder ? 'ok' : 'no', !isChat ? '' : info.recorder ? (page.generating ? t('popup.answering') : '') : t('popup.reload'));

  const chatId = info && info.conversationId;
  idRow('chat', !isChat ? 'off' : chatId ? 'ok' : 'wait', !isChat ? '' : chatId ? shorten(chatId, 8) : t('popup.newChat'), chatId);

  const requestId = page && page.requestId;
  idRow('req', !isChat ? 'off' : requestId ? 'ok' : 'wait', !isChat ? '' : requestId ? shorten(requestId, 9) : t('popup.noneYet'), requestId);

  const state = pipeline(info, ready);
  stage('read', ...state.read);
  stage('sent', ...state.sent);
  stage('proc', ...state.proc);
  $('why').textContent = state.why[1];
  $('why').className = `why ${state.why[0]}`;
  paintCalls(page);

  const broken = state.why[0] === 'bad';
  const flowing = state.proc[0] === 'done';
  row(
    'app',
    !isChat ? 'off' : broken ? 'no' : flowing ? 'ok' : 'wait',
    !isChat ? '' : broken ? t('popup.blocked') : flowing ? ago(info.delivery && info.delivery.at) || t('popup.live') : t('popup.waiting')
  );
  // Opens itself the first time something is actually wrong, so the panel that explains
  // the failure is already open when the popup is opened to look at one.
  if (broken && !openedOnFailure) {
    openedOnFailure = true;
    $('stream').open = true;
  }

  paintAlert(status, info);
  paintDetails(status, info);
}

async function refresh() {
  const [status, info] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'status' }),
    chrome.runtime.sendMessage({ type: 'tabStatus' }).catch(() => null)
  ]);
  latest = { status, tab: info };
  paintSnapshot(status, info);
}

// -------------------------------------------------------------------- controls

function syncOverwrite() {
  $('overwriteToggle').checked = overwriteEnabled;
}

async function loadPreferences() {
  const stored = await chrome.storage.local.get([
    RENDER_STREAM_KEY,
    SHOW_TIMES_KEY,
    UI_LANGUAGE_KEY
  ]);
  overwriteEnabled = stored[RENDER_STREAM_KEY] !== false;
  showTimes = stored[SHOW_TIMES_KEY] === true;
  languagePreference = validLanguagePreference(stored[UI_LANGUAGE_KEY]) ? stored[UI_LANGUAGE_KEY] : 'system';
  refreshLanguage();
  applyLanguage();
  syncOverwrite();
  $('timeToggle').checked = showTimes;
}

/** Puts one value on the clipboard and says so in place, without moving anything. */
async function copyInto(button, text) {
  if (!text) return;
  const was = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = t('popup.copied');
  } catch {
    button.textContent = t('popup.copyFailed');
  }
  setTimeout(() => {
    if (button.textContent === t('popup.copied') || button.textContent === t('popup.copyFailed')) button.textContent = was;
  }, 900);
}

for (const id of ['d-chat', 'd-req']) {
  $(id).addEventListener('click', (event) => {
    event.preventDefault();
    void copyInto(event.currentTarget, event.currentTarget.title);
  });
}

$('copyBtn').addEventListener('click', (event) => {
  const cells = [...$('grid').children].map((node) => node.textContent);
  const lines = [$('why').textContent];
  for (let index = 0; index < cells.length; index += 2) lines.push(`${cells[index]}: ${cells[index + 1]}`);
  void copyInto(event.currentTarget, lines.join('\n'));
});

$('languageSelect').addEventListener('change', async () => {
  languagePreference = validLanguagePreference($('languageSelect').value) ? $('languageSelect').value : 'system';
  await chrome.storage.local.set({ [UI_LANGUAGE_KEY]: languagePreference });
  refreshLanguage();
  applyLanguage();
  await refresh();
});

$('more').addEventListener('toggle', () => paintDetails(latest.status, latest.tab));

$('reloadBtn').addEventListener('click', () => {
  // The old worker may be stuck: this explicit action belongs to the popup itself.
  chrome.runtime.reload();
});

$('retryBtn').addEventListener('click', async () => {
  $('retryBtn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'pair' });
  $('retryBtn').disabled = false;
  await refresh();
});

$('unpairBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'unpair' });
  await refresh();
});

$('overwriteToggle').addEventListener('change', async () => {
  const previous = overwriteEnabled;
  overwriteEnabled = $('overwriteToggle').checked === true;
  syncOverwrite();
  try {
    await chrome.storage.local.set({ [RENDER_STREAM_KEY]: overwriteEnabled });
    // The toggle is the action. Enabling it immediately pulls the latest app timeline into
    // every known ChatGPT tab; there is deliberately no second "Overwrite now" button.
    if (overwriteEnabled) await chrome.runtime.sendMessage({ type: 'overwriteNow' });
  } catch {
    overwriteEnabled = previous;
    syncOverwrite();
  }
});

$('timeToggle').addEventListener('change', async () => {
  showTimes = $('timeToggle').checked === true;
  await chrome.storage.local.set({ [SHOW_TIMES_KEY]: showTimes });
});

// Paint immediately from the extension's own persistent language preference.
applyLanguage();
void loadPreferences().catch(() => undefined);
void refresh().catch(() => undefined);
// A popup is open for seconds at a time and the three stages move within those seconds.
setInterval(() => void refresh().catch(() => undefined), POLL_MS);
