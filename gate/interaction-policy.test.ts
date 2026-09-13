import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAsyncActionGate, createLatestAsyncIntentGate, nextMenuIndex, nextSidebarPeek } from '../src/renderer/interaction-policy.js';

describe('interaction policy gate', () => {
  it('coalesces a duplicate in-flight UI action and releases the key afterward', async () => {
    const gate = createAsyncActionGate();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const first = gate.run('same-action', async () => { calls += 1; await wait; return 'first'; });
    const duplicate = await gate.run('same-action', async () => { calls += 1; return 'duplicate'; });
    expect(duplicate).toBeUndefined();
    expect(calls).toBe(1);
    expect(gate.isActive('same-action')).toBe(true);
    release();
    await expect(first).resolves.toBe('first');
    expect(gate.isActive('same-action')).toBe(false);
    await expect(gate.run('same-action', async () => 'next')).resolves.toBe('next');
  });

  it('releases an action key after failure', async () => {
    const gate = createAsyncActionGate();
    await expect(gate.run('failing', async () => { throw new Error('expected'); })).rejects.toThrow('expected');
    expect(gate.isActive('failing')).toBe(false);
    await expect(gate.run('failing', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('keeps only the latest async intent current when replies finish out of order', async () => {
    const gate = createLatestAsyncIntentGate();
    let releaseA!: () => void;
    let releaseB!: () => void;
    const waitA = new Promise<void>((resolve) => { releaseA = resolve; });
    const waitB = new Promise<void>((resolve) => { releaseB = resolve; });
    const a = gate.run('A', async () => { await waitA; return 'A'; });
    const b = gate.run('B', async () => { await waitB; return 'B'; });
    releaseB();
    await expect(b).resolves.toEqual({ value: 'B', current: true, started: true });
    releaseA();
    await expect(a).resolves.toEqual({ value: 'A', current: false, started: true });
  });

  it('coalesces duplicate work for the same latest intent', async () => {
    const gate = createLatestAsyncIntentGate();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const first = gate.run('same', async () => { calls += 1; await wait; return 'done'; });
    const duplicate = gate.run('same', async () => { calls += 1; return 'duplicate'; });
    expect(calls).toBe(1);
    release();
    await expect(first).resolves.toEqual({ value: 'done', current: true, started: true });
    await expect(duplicate).resolves.toEqual({ value: 'done', current: true, started: false });
    expect(calls).toBe(1);
  });

  it('implements wrapping Arrow/Home/End menu navigation', () => {
    expect(nextMenuIndex(0, 'ArrowDown', 3)).toBe(1);
    expect(nextMenuIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextMenuIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowLeft', 3)).toBe(2);
    expect(nextMenuIndex(1, 'Home', 3)).toBe(0);
    expect(nextMenuIndex(1, 'End', 3)).toBe(2);
    expect(nextMenuIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextMenuIndex(-1, 'ArrowUp', 3)).toBe(2);
    expect(nextMenuIndex(-1, 'ArrowDown', 0)).toBe(-1);
  });

  it('keeps sidebar collapse on the shared navigation path without changing layout', () => {
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    expect(renderer).toContain("const sidebarCollapseButton = $<HTMLButtonElement>('sidebarCollapseButton');");
    expect(renderer).toContain('PanelLeftClose');
    expect(renderer).toContain('PanelLeftOpen');
    expect(renderer).toContain("if (!state || state.config.navigationLayout !== 'sidebar') return;");
    expect(renderer).toContain('sidebarCollapsed: !previous.config.sidebarCollapsed');
    expect(renderer).toContain('sidebarCollapseButton.hidden = !sidebar;');
    expect(renderer).toContain("appRoot.dataset.sidebarCollapsed = String(collapsed)");
    expect(renderer).toContain('renderPanelControlIcon(sidebarCollapseButton, collapsed ? PanelLeftOpen : PanelLeftClose);');
    expect(html).not.toContain('sidebarCollapseDivider');
  });

  it('peeks only from the edge, holds inside the sidebar and retracts after leaving both', () => {
    expect(nextSidebarPeek(false, true, false, true)).toBe(true);
    expect(nextSidebarPeek(false, true, true, false)).toBe(false);
    expect(nextSidebarPeek(true, true, true, false)).toBe(true);
    expect(nextSidebarPeek(true, true, false, true)).toBe(true);
    expect(nextSidebarPeek(true, true, false, false)).toBe(false);
    expect(nextSidebarPeek(true, false, true, true)).toBe(false);
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).toContain("sidebarPeekZone.addEventListener('pointerenter'");
    expect(renderer).toContain('|| sidebarCollapseButton.contains(target)');
    expect(renderer).toContain("sidebarShell.addEventListener('pointerleave', retractSidebarPeekAfterLeave)");
    expect(renderer).toContain("sidebarCollapseButton.addEventListener('pointerleave', retractSidebarPeekAfterLeave)");
    expect(renderer).toContain("sidebarPeekZone.addEventListener('pointerleave', retractSidebarPeekAfterLeave)");
  });

  it('keeps the sidebar resize bounded and collapses when dragged inward past minimum', () => {
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(renderer).toContain('const SIDEBAR_DEFAULT_WIDTH_PX = 200;');
    expect(renderer).toContain('const SIDEBAR_MIN_WIDTH_PX = 200;');
    expect(renderer).toContain('const SIDEBAR_MAX_WIDTH_PX = 400;');
    expect(renderer).toContain("appRoot.style.setProperty('--sidebar-width', `${sidebarWidthPx}px`);");
    expect(renderer).toContain("sidebarResizeHandle.addEventListener('pointerdown'");
    expect(renderer).toContain('if (state.config.sidebarCollapsed && !sidebarPeek) return;');
    expect(renderer).toContain('const nextWidth = startWidth + moveEvent.clientX - startX;');
    expect(renderer).toContain('if (nextWidth < SIDEBAR_MIN_WIDTH_PX) {');
    expect(renderer).toContain('sidebarCollapsed: true');
    expect(styles).toContain('.app { --sidebar-width: 200px; }');
    expect(renderer).toContain('const TITLEBAR_CONTROL_SIZE_PX = 30;');
    expect(renderer).toContain('const TITLEBAR_PANEL_ICON_SIZE_PX = 20;');
    expect(renderer).toContain('function syncTitlebarControlMetrics(percent: number): void {');
    expect(styles).toContain('left: var(--titlebar-sidebar-control-left);');
    expect(styles).toContain('top: var(--titlebar-control-top);');
    expect(styles).toContain('width: var(--titlebar-control-size);');
    expect(styles).toContain('width: var(--titlebar-panel-icon-size);');
    expect(styles).toContain('transition: transform .1s cubic-bezier(.2, .8, .2, 1);');
  });

  it('mirrors the full-height splitter and collapse interaction onto the DaVinci workspace', () => {
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(html).toContain('id="davinciCollapseButton"');
    expect(html).toContain('id="cockpitResizeHandle"');
    expect(renderer).toContain('PanelRightClose');
    expect(renderer).toContain('PanelRightOpen');
    expect(renderer).toContain('const DAVINCI_MIN_WIDTH_PX = 200;');
    expect(renderer).toContain("davinciCollapseButton.addEventListener('click'");
    expect(renderer).toContain("cockpitResizeHandle.addEventListener('pointerdown'");
    expect(renderer).toContain('const nextWidth = startWidth - (moveEvent.clientX - startX);');
    expect(renderer).toContain('setDavinciCollapsed(true);');
    expect(renderer).toContain('renderPanelControlIcon(davinciCollapseButton, next ? PanelRightOpen : PanelRightClose);');
    expect(renderer).toContain('setDavinciCollapsed(false);');
    expect(styles).toContain(".cockpit-resize-handle {\n  position: absolute;\n  z-index: 65;\n  top: -30px;");
    expect(styles).toContain(".app[data-navigation-layout='sidebar'] .sidebar-resize-handle {\n  position: absolute;\n  z-index: 65;\n  top: 0;");
    expect(styles).toContain(".cockpit-shell[data-davinci-collapsed='true'] { grid-template-columns: minmax(0, 1fr) 0; }");
    expect(styles).toContain('top: calc(-30px + var(--titlebar-control-top));');
  });

  it('renders the shared connection state as a four-bar signal without visible status text', () => {
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect((html.match(/class="signal-bar"/g) ?? [])).toHaveLength(4);
    expect(html).toContain('id="headline" class="connection-signal is-idle" data-tab="setup" type="button"');
    expect(html).toContain('class="connection-signal-label"');
    expect(renderer).toContain("setConnectionSignal('is-good', t('headline.connected'))");
    expect(renderer).toContain("setConnectionSignal('is-bad', t('headline.attention'))");
    expect(renderer).toContain("setConnectionSignal('is-connecting', t('headline.connecting'))");
    expect(renderer).toContain("setConnectionSignal('is-idle', t('headline.disconnected'))");
    expect(styles).toContain('@keyframes connection-signal-fill');
    expect(styles).toContain('flex-direction: row-reverse;');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(styles).toContain('grid-column: 2;');
    expect(styles).toContain(".app[data-navigation-layout='sidebar'] .connection-signal.is-sel");
    expect(styles).toContain('height: 36px;');
    expect(styles).toContain('border-radius: 8px;');
    expect(renderer).toContain("activeView = isSetupComplete(stateReply.data) ? 'cockpit' : 'setup';");
  });

  it('keeps the Conversation mounted while only the right Artifact lens changes', () => {
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="conversationPane"');
    expect(html).toContain('id="davinciTabs"');
    expect(html).toContain('id="agentFocusLink"');
    expect(html).toContain('id="agentEvidenceLinks"');
    expect(html).toContain('id="agentTraceList"');
    expect((html.match(/data-artifact-lens-panel=/g) ?? [])).toHaveLength(8);
    expect(renderer).toContain("$('cockpitShell').classList.toggle('is-active', view === 'cockpit');");
    expect(renderer).toContain("section.classList.toggle('is-active', section.dataset.artifactLensPanel === artifactPresentation.selectedLens);");
    expect(renderer).toContain('selectArtifactForInspection(artifactPresentation, artifactWorkspace');
    expect(renderer).not.toContain('api.resolveAgentEntity(');
    expect(renderer).toContain('if (focus) focusedAgentEntity = focus.entity;');
    expect(renderer).toContain('api.setTimelineArtifactFocus(handle, generation)');
    expect(preload).not.toContain('AgentEntityRef');
    expect(renderer).toContain("if (projection.target.kind === 'timeline_item')");
    expect(renderer).toContain('api.focusWorkflowPlanTarget(projection.planId)');
    expect(renderer).toContain('api.approveWorkflowPlan(projection.planId)');
    expect(renderer).toContain('api.rejectWorkflowPlan(projection.planId)');
    expect(renderer).not.toContain('projection.plan.');
    expect(renderer).not.toContain('target_ids');
    expect(renderer).not.toContain('input_fingerprint');
    expect(renderer).not.toContain('structure_fingerprint');
    expect(renderer).not.toContain('custom_data');
    expect(preload).not.toMatch(/\bWorkflowPlanProjection\b/);
    expect(preload).toContain('RendererWorkflowPlanProjection');
    expect(renderer).toContain('function openEvidence(evidence: AgentEvidenceRef): void');
    expect(renderer).toContain('function openAgentTrace(turnId: string): void');
    expect(renderer).toContain('function bindEditArtifactInspectionRow(');
    expect(renderer).toContain("candidate.kind === 'timeline_item'");
    expect(renderer).toContain('candidate.semanticHandle === item.semanticHandle');
    expect(renderer).not.toContain('selectArtifactByExactEntity');
    expect(renderer).toContain('function bindMediaArtifactInspectionRow(');
    expect(renderer).toContain("candidate.kind === 'media_item' && candidate.semanticHandle === item.semanticHandle");
    expect(renderer).toContain('api.inspectMediaClip(handle, generation)');
    expect(renderer).toContain('api.setMediaArtifactFocus(artifact.semanticHandle, artifact.generation)');
    expect(renderer).not.toContain("selectArtifactByExactEntity('media_pool_item'");
    expect((renderer.match(/setWorkspaceFocus\(/g) ?? [])).toHaveLength(2);
    expect(renderer).not.toContain('bindSharedFocusRow');
    expect(html).not.toContain('data-panel="chat"');
    expect(renderer).not.toContain('activePanel');
  });

  it('keeps action buttons on one shared geometry with explicit semantic variants', () => {
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('.btn { min-height: 36px;');
    expect(styles).toContain('.btn-primary {');
    expect(styles).toContain('.btn-danger {');
    expect(html).not.toContain('btn-solid');
    expect(renderer).not.toContain('btn-solid');
    expect(renderer).toContain("remove.className = 'btn btn-danger btn-icon';");
    expect(renderer).toContain("approve.className = 'btn btn-primary';");
    expect(renderer).toContain("reject.className = 'btn btn-danger';");
  });

  it('keeps vertical setup separators optically detached from the next step marker', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain(".step:not(:last-child)::before { content: ''; position: absolute; z-index: 0; top: 38px; bottom: 6px;");
  });

  it('renders app preferences as visible settings cards rather than an advanced-settings disclosure', () => {
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    expect(html).toContain('class="settings-preferences"');
    expect((html.match(/class="workflow-card settings-card"/g) ?? [])).toHaveLength(4);
    expect(html).not.toContain('class="advanced-settings"');
    expect(html).toContain('id="languageButtonLabel"');
  });

  it('keeps non-Agent Simplified Chinese UI free of generic untranslated setup and reader terms', () => {
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    const i18n = readFileSync(new URL('../src/renderer/i18n.ts', import.meta.url), 'utf8');
    const zh = i18n.split('const ZH: Record<Key, string> = {')[1]?.split('\n};')[0] ?? '';
    expect(html).toContain('data-i18n="setup.step1">STEP 1</div>');
    expect(html).toContain('data-i18n="setup.step6">STEP 6</div>');
    expect(zh).toContain("'setup.step1': '步骤 1'");
    expect(zh).toContain("'setup.step6': '步骤 6'");
    expect(zh).toContain("'key.owner': '你'");
    expect(zh).toContain("'key.permissions': '全部'");
    expect(zh).not.toContain('getter-only');
    expect(zh).not.toContain('Project Preflight');
    expect(zh).not.toContain(' source start/end');
    expect(zh).not.toContain(' bit ');
  });
});
