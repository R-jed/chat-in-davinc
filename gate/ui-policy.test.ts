import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  callArguments,
  customPropertiesForRule,
  declarationValues,
  dynamicControls,
  eventListenerTypes,
  fontWeightAudit,
  htmlButtons,
  htmlElements,
  htmlOpeningTags,
  motionDurationAudit,
  normalizeCssValue,
  parseCss,
  rootCustomProperties,
  staticInnerHtmlFragments,
  visibleHtmlText,
  type CssRule
} from './ui-policy-helpers.js';

type ExceptionCurrent = string | number | string[];
interface PolicyException {
  id: string;
  layer: string;
  rule: string;
  selector: string;
  property: string;
  current: ExceptionCurrent;
  max?: number;
  reason: string;
}

const root = process.cwd();
const html = readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const css = readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
const renderer = readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
const policy = JSON.parse(readFileSync(path.join(root, 'UI_POLICY_EXCEPTIONS.json'), 'utf8')) as {
  version: number;
  source: string;
  exceptions: PolicyException[];
};
const rules = parseCss(css);
const rootVariables = rootCustomProperties(rules);

const expectedExceptionIdentity = new Map<string, [rule: string, selector: string, property: string]>([
  ['zoom-notice-motion', ['motion.max-duration', '.zoom-notice', 'transition']],
  ['topbar-material-motion', ['motion.max-duration', '.topbar', 'transition']],
  ['workspace-tab-indicator-motion', ['motion.max-duration', '.workspace-tab-indicator', 'transition']],
  ['settings-icon-motion', ['motion.max-duration', '.utility-button .settings-icon', 'transition']],
  ['connection-signal-progress-motion', ['motion.max-duration', '.connection-signal.is-connecting .signal-bar::after', 'animation']],
  ['zoom-control-light-glyph', ['typography.min-font-weight', '.zoom-control-button', 'font-weight']],
  ['zoom-notice-blur-scale', ['optimization.filled-blur-scale', '.zoom-notice', 'filter']],
  ['zoom-notice-compositor-transform', ['optimization.gpu-promotion', '.zoom-notice', 'transform']],
  ['topbar-backdrop-blur', ['optimization.backdrop-blur', '.topbar', 'backdrop-filter']],
  ['desktop-explicit-setup-submit', ['interaction.form-submit', '#wizard', 'submit-trigger']],
  ['desktop-interactive-text-selection', ['interaction.user-select', 'interactive-controls', 'user-select']],
  ['desktop-fixed-type-scale', ['typography.fluid-clamp', ':root', '--type-*']],
  ['current-numeric-spacing', ['typography.tabular-nums', 'numeric-content', 'font-variant-numeric/font-feature-settings']],
  ['native-selection-colors', ['design.selection', '::selection', 'selection-style']],
  ['language-menu-click-timing', ['accessibility.dropdown-mousedown', '#languageButton', 'event-listener']],
  ['workspace-tab-hit-gap', ['interaction.dead-area', '.workspace-tabs', 'gap']],
  ['current-global-error-dialogs', ['design.feedback-location', 'window.alert', 'window.alert(argument)']],
  ['current-heading-weights', ['typography.heading-weight', 'heading-tokens', 'font-weight']]
]);

function exceptionById(id: string): PolicyException {
  const entry = policy.exceptions.find((candidate) => candidate.id === id);
  expect(entry, `registered exception ${id} must exist`).toBeDefined();
  return entry!;
}

function serializeDeclarations(filter: (rule: CssRule, property: string, value: string) => boolean): string[] {
  const values: string[] = [];
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      const value = normalizeCssValue(declaration.value);
      if (filter(rule, declaration.property, value)) values.push(`${rule.selector}|${declaration.property}=${value}`);
    }
  }
  return values;
}

function alertEvidence(): string[] {
  const sites: string[] = [];
  let currentFunction = 'module';
  for (const line of renderer.split('\n')) {
    const declaration = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)(?:<[^>]+>)?\s*\(/);
    if (declaration?.[1]) currentFunction = declaration[1];
    for (const argument of callArguments(line, 'window.alert')) sites.push(`${currentFunction}|${argument}`);
  }
  return sites;
}

function headingWeightEvidence(): string[] {
  const values: string[] = [];
  for (const rule of rules) {
    if (!/\bh[1-6]\b/.test(rule.selector)) continue;
    const variables = customPropertiesForRule(rule, rootVariables);
    for (const declaration of rule.declarations) {
      if (declaration.property !== 'font-weight' && declaration.property !== 'font') continue;
      const audit = fontWeightAudit(declaration.property, declaration.value, variables);
      if (!audit || audit.unsupported.length > 0) values.push(`${rule.selector}=unsupported:${normalizeCssValue(declaration.value)}`);
      else for (const weight of audit.weights) values.push(`${rule.selector}=${weight}`);
    }
  }
  return values;
}

function liveEvidence(entry: PolicyException): ExceptionCurrent {
  switch (entry.id) {
    case 'zoom-notice-motion':
    case 'topbar-material-motion':
    case 'workspace-tab-indicator-motion':
    case 'settings-icon-motion':
    case 'connection-signal-progress-motion': {
      const values = declarationValues(rules, entry.selector, entry.property);
      expect(values, `${entry.id} must match exactly one live declaration`).toHaveLength(1);
      return values[0]!;
    }
    case 'zoom-control-light-glyph': {
      const values = declarationValues(rules, entry.selector, entry.property);
      expect(values, `${entry.id} must match exactly one live declaration`).toHaveLength(1);
      return values[0]!;
    }
    case 'zoom-notice-blur-scale':
      return serializeDeclarations((_rule, property, value) => property === 'filter' && value.includes('blur('));
    case 'zoom-notice-compositor-transform':
      return serializeDeclarations((rule, property) => property === 'transform' && (rule.selector === '.zoom-notice' || rule.selector === '.zoom-notice.is-visible'));
    case 'topbar-backdrop-blur':
      return serializeDeclarations((_rule, property, value) => ['backdrop-filter', '-webkit-backdrop-filter'].includes(property) && value.includes('blur('));
    case 'desktop-explicit-setup-submit': {
      const wizard = htmlOpeningTags(html, 'ol').find((tag) => tag.attributes.get('id') === 'wizard');
      const connect = htmlOpeningTags(html, 'button').find((tag) => tag.attributes.get('id') === 'wizConnect' && tag.attributes.get('type') === 'button');
      const formWrapped = htmlElements(html, 'form').some((form) =>
        Boolean((wizard && wizard.start > form.start && wizard.end < form.end) || (connect && connect.start > form.start && connect.end < form.end)));
      const clickBound = /\$\(['"]wizConnect['"]\)\.addEventListener\(\s*['"]click['"]/.test(renderer);
      return wizard && connect && !formWrapped && clickBound ? 'ol#wizard + #wizConnect[type=button] + click + no-form-submit' : 'changed';
    }
    case 'desktop-interactive-text-selection': {
      const userSelect = rules.flatMap((rule) => rule.declarations).filter((declaration) => declaration.property.endsWith('user-select'));
      return userSelect.length === 0 ? 'native' : 'overridden';
    }
    case 'desktop-fixed-type-scale': {
      const keys = ['--type-caption', '--type-small', '--type-body', '--type-subhead', '--type-section', '--type-title'];
      const hasFluidFontSize = rules.some((rule) => rule.declarations.some((declaration) => declaration.property === 'font-size' && /\bclamp\(/.test(declaration.value)));
      if (hasFluidFontSize) return ['fluid-clamp-present'];
      return keys.map((key) => `${key}=${normalizeCssValue(rootVariables.get(key) ?? 'missing')}`);
    }
    case 'current-numeric-spacing': {
      const tabular = rules.some((rule) => rule.declarations.some((declaration) =>
        (declaration.property === 'font-variant-numeric' && /tabular-nums/.test(declaration.value))
        || (declaration.property === 'font-feature-settings' && /["']tnum["']/.test(declaration.value))));
      return tabular ? 'tabular' : 'normal';
    }
    case 'native-selection-colors':
      return rules.some((rule) => rule.selector.includes('::selection')) ? 'custom' : 'native';
    case 'language-menu-click-timing': {
      const pointerEvents = eventListenerTypes(renderer, 'languageButton').filter((event) => ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].includes(event));
      return pointerEvents.join(',');
    }
    case 'workspace-tab-hit-gap':
      return declarationValues(rules, '.workspace-tabs', 'gap');
    case 'current-global-error-dialogs':
      return alertEvidence();
    case 'current-heading-weights':
      return headingWeightEvidence();
    default:
      throw new Error(`Unknown UI policy exception id: ${entry.id}`);
  }
}

function checkStaticInputs(source: string, sourceName: string): void {
  const labelElements = htmlElements(source, 'label');
  const labels = new Set(labelElements.map((tag) => tag.attributes.get('for')).filter((value): value is string => Boolean(value)));
  for (const input of htmlOpeningTags(source, 'input')) {
    const id = input.attributes.get('id') ?? '';
    const wrapped = labelElements.some((label) => input.start > label.start && input.end < label.end);
    if (input.attributes.get('type') === 'checkbox') {
      expect(wrapped || Boolean(id && labels.has(id)), `${sourceName} checkbox${id ? ` #${id}` : ''} must have an associated label`).toBe(true);
      continue;
    }
    expect(id, `${sourceName} non-checkbox input must have an id`).not.toBe('');
    expect(labels.has(id), `${sourceName} input #${id} must have a label[for]`).toBe(true);
  }
}

function checkStaticButtonNames(source: string, sourceName: string): void {
  for (const button of htmlButtons(source)) {
    if (visibleHtmlText(button.content).length > 0) continue;
    const named = Boolean(button.attributes.get('aria-label') || button.attributes.get('aria-labelledby'));
    expect(named, `${sourceName} icon-only button must expose aria-label or aria-labelledby: ${button.raw.slice(0, 100)}`).toBe(true);
  }
}

describe('UI policy static gate', () => {
  it('keeps every design exception explicit, pinned, unique and known', () => {
    expect(policy.version).toBe(2);
    expect(policy.source).toBe('https://github.com/raunofreiberg/interfaces');
    const ids = policy.exceptions.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...expectedExceptionIdentity.keys()].sort());
    for (const entry of policy.exceptions) {
      expect(entry.layer).toBe('design-exception');
      expect(entry.reason.length).toBeGreaterThan(12);
      expect(entry.property.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.current) ? entry.current.length : String(entry.current).length).toBeGreaterThan(0);
      expect([entry.rule, entry.selector, entry.property], `${entry.id} identity changed`).toEqual(expectedExceptionIdentity.get(entry.id));
      if (entry.max !== undefined) expect(entry.max).toBeGreaterThan(0);
    }
  });

  it('requires labels and identifier protections for static and embedded inputs', () => {
    checkStaticInputs(html, 'renderer HTML');
    const embedded = staticInnerHtmlFragments(renderer);
    expect(embedded.unsupportedControlTemplates, 'dynamic innerHTML controls must remain statically inspectable').toBe(0);
    embedded.fragments.forEach((fragment, index) => checkStaticInputs(fragment, `innerHTML fragment ${index}`));

    const inputs = htmlOpeningTags(html, 'input');
    for (const id of ['workflowTunnelId', 'tunnelId', 'apiKey']) {
      const input = inputs.find((candidate) => candidate.attributes.get('id') === id);
      expect(input, `input #${id} must exist`).toBeDefined();
      expect(input!.attributes.get('autocomplete'), `input #${id} must disable autocomplete`).toBe('off');
      expect(input!.attributes.get('spellcheck'), `input #${id} must disable spellcheck`).toBe('false');
    }
    for (const id of ['workflowTunnelId', 'tunnelId']) {
      const input = inputs.find((candidate) => candidate.attributes.get('id') === id)!;
      expect(input.attributes.get('pattern'), `input #${id} must expose the canonical Tunnel ID pattern`).toBe('tunnel_[0-9a-f]{32}');
    }
  });

  it('covers static, embedded and createElement controls for accessible names', () => {
    checkStaticButtonNames(html, 'renderer HTML');
    const embedded = staticInnerHtmlFragments(renderer);
    embedded.fragments.forEach((fragment, index) => checkStaticButtonNames(fragment, `innerHTML fragment ${index}`));

    const dynamic = dynamicControls(renderer);
    expect(dynamic.unsupportedCreations, 'document.createElement button/input forms must be statically inspectable').toBe(0);
    const staticLabels = new Set(htmlOpeningTags(html, 'label').map((tag) => tag.attributes.get('for')).filter((value): value is string => Boolean(value)));
    for (const control of dynamic.controls) {
      if (control.tag === 'button') {
        expect(control.visibleText || control.ariaLabel || control.ariaLabelledBy, `dynamic button ${control.variable} must have visible text or an explicit accessible name`).toBe(true);
      } else {
        expect(control.ariaLabel || control.ariaLabelledBy || Boolean(control.id && staticLabels.has(control.id)), `dynamic input ${control.variable} must have an accessible label`).toBe(true);
      }
    }
  });

  it('requires visible keyboard focus without permanent will-change hints', () => {
    expect(css).not.toMatch(/\bwill-change\s*:/);
    expect(css).toMatch(/\.media-inventory-row\.is-selectable:focus-visible[^}]*box-shadow:/s);
    expect(css).toMatch(/\.agent-focus-link:focus-visible[^}]*box-shadow:/s);
    expect(css).toMatch(/\.btn:focus-visible[^}]*box-shadow:/s);
    expect(css).toMatch(/\.workspace-tabs button:focus-visible[^}]*box-shadow:/s);
    expect(css).toMatch(/\.language-option:focus-visible[^}]*box-shadow:/s);
  });

  it('rejects unregistered transition or animation motion above 200ms and fails closed on unresolved duration math', () => {
    const violations: string[] = [];
    for (const rule of rules) {
      const variables = customPropertiesForRule(rule, rootVariables);
      for (const declaration of rule.declarations) {
        const audit = motionDurationAudit(declaration.property, declaration.value, variables);
        if (!audit) continue;
        if (audit.unsupported.length > 0) {
          violations.push(`${rule.selector} ${declaration.property}: unsupported ${audit.unsupported.join(',')}`);
          continue;
        }
        const observedMax = Math.max(0, ...audit.durationsMs);
        if (observedMax <= 200) continue;
        const current = normalizeCssValue(declaration.value);
        const allowed = policy.exceptions.find((entry) => entry.rule === 'motion.max-duration'
          && entry.selector === rule.selector
          && entry.property === declaration.property
          && entry.current === current
          && entry.max === observedMax);
        if (!allowed) violations.push(`${rule.selector} ${declaration.property}=${current} (${observedMax}ms)`);
      }
    }
    expect(violations, 'register an exact approved motion declaration/current value/max or reduce it to <=200ms').toEqual([]);
  });

  it('rejects unregistered font weights below 400 through font-weight, font shorthand and resolvable CSS vars', () => {
    const violations: string[] = [];
    for (const rule of rules) {
      const variables = customPropertiesForRule(rule, rootVariables);
      for (const declaration of rule.declarations) {
        const audit = fontWeightAudit(declaration.property, declaration.value, variables);
        if (!audit) continue;
        if (audit.unsupported.length > 0) {
          violations.push(`${rule.selector} ${declaration.property}: unsupported ${audit.unsupported.join(',')}`);
          continue;
        }
        if (!audit.weights.some((weight) => weight < 400)) continue;
        const current = normalizeCssValue(declaration.value);
        const allowed = policy.exceptions.find((entry) => entry.rule === 'typography.min-font-weight'
          && entry.selector === rule.selector
          && entry.property === declaration.property
          && entry.current === current);
        if (!allowed) violations.push(`${rule.selector} ${declaration.property}=${current}`);
      }
    }
    expect(violations, 'register an exact optical exception or use font weight >=400').toEqual([]);
  });

  it('keeps blur and global error exceptions at their exact approved identities', () => {
    expect(liveEvidence(exceptionById('zoom-notice-blur-scale'))).toEqual(exceptionById('zoom-notice-blur-scale').current);
    expect(liveEvidence(exceptionById('topbar-backdrop-blur'))).toEqual(exceptionById('topbar-backdrop-blur').current);
    const errorException = exceptionById('current-global-error-dialogs');
    const alerts = callArguments(renderer, 'window.alert');
    expect(alerts.length).toBe(errorException.max);
    expect(alertEvidence()).toEqual(errorException.current);
  });

  it('requires every registered exception id to be consumed by live current evidence', () => {
    const consumed = new Set<string>();
    for (const entry of policy.exceptions) {
      const evidence = liveEvidence(entry);
      expect(evidence, `${entry.id} is stale or its approved current value changed`).toEqual(entry.current);
      if (entry.rule === 'motion.max-duration') {
        const values = declarationValues(rules, entry.selector, entry.property);
        const rule = rules.find((candidate) => candidate.selector === entry.selector && candidate.declarations.some((declaration) => declaration.property === entry.property && normalizeCssValue(declaration.value) === values[0]));
        const declaration = rule?.declarations.find((candidate) => candidate.property === entry.property && normalizeCssValue(candidate.value) === values[0]);
        const audit = rule && declaration ? motionDurationAudit(declaration.property, declaration.value, customPropertiesForRule(rule, rootVariables)) : null;
        expect(audit?.unsupported ?? [], `${entry.id} current motion must remain statically resolvable`).toEqual([]);
        expect(Math.max(0, ...(audit?.durationsMs ?? [])), `${entry.id} max must pin the current observed duration`).toBe(entry.max);
      }
      consumed.add(entry.id);
    }
    expect([...consumed].sort()).toEqual([...expectedExceptionIdentity.keys()].sort());
  });

  it('locks the no-visual-change Required interaction safeguards into the renderer', () => {
    expect(renderer).toContain("actionGate.run('setup:probe-resolve'");
    expect(renderer).toContain("actionGate.run('setup:connection'");
    expect(renderer).toContain('actionGate.run(`workflow-plan:${projection.planId}`');
    expect(renderer).toContain('else if (state === previous) paint(previous, true);');
  });

  it('locks keyboard navigation into sequential desktop controls', () => {
    expect(html).toContain('<nav class="workspace-tabs" id="tabs" aria-label="Conversations"');
    expect((html.match(/id="tabs"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('data-artifact-lens="summary" type="button" aria-current="page"');
    expect(renderer).toContain("button.setAttribute('aria-current', 'page')");
    expect(renderer).toContain("button.removeAttribute('aria-current')");
    expect(renderer).toContain("event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End'");
    expect(renderer).toContain("davinciTabs.querySelectorAll<HTMLButtonElement>('button[data-artifact-lens]:not(:disabled)')");
    expect(renderer).toContain("$('mediaInventoryList').querySelectorAll<HTMLElement>('.media-inventory-row.is-selectable')");
    expect(renderer).toContain("event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End'");
  });

  it('keeps one Sidebar, persistent Conversation and one four-layer Artifact Workspace', () => {
    expect(html).toContain('id="app" data-navigation-layout="sidebar"');
    expect((html.match(/class="workspace-tabs"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="sidebarCollapseButton"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="agentSessionList"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="conversationPane"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="davinciWorkspace"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-artifact-lens="(?:summary|project|media|edit|fusion|color|fairlight|deliver)"/g) ?? [])).toHaveLength(8);
    expect((html.match(/data-artifact-lens-panel="(?:summary|project|media|edit|fusion|color|fairlight|deliver)"/g) ?? [])).toHaveLength(8);
    expect((html.match(/id="artifactContextLayer"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="artifactActiveLayer"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="artifactPlanLayer"/g) ?? [])).toHaveLength(1);
    expect((html.match(/id="artifactEvidenceLayer"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('data-domain=');
    expect(html).not.toContain('data-domain-panel=');
    expect((html.match(/data-tab="setup"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-tab="settings"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-tab="activity"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-panel="setup"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-panel="settings"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-panel="activity"/g) ?? [])).toHaveLength(1);
    expect(renderer).toContain("type AppView = 'cockpit' | 'activity' | 'setup' | 'settings';");
    expect(renderer).toContain("$('cockpitShell').classList.toggle('is-active', view === 'cockpit');");
    expect(renderer).toContain("section.classList.toggle('is-active', section.dataset.artifactLensPanel === artifactPresentation.selectedLens);");
    expect(renderer).not.toContain('activeDomain');
    expect(renderer).not.toContain('selectDavinciDomain');
    expect(renderer).not.toContain('agentSessionSelect');
    expect(renderer).not.toContain('agentNewChat');
    expect(renderer).toContain("appRoot.dataset.navigationLayout = next.config.navigationLayout");
    expect(renderer).toContain("navigationLayoutSidebar').checked ? 'sidebar' : 'topbar'");
    expect(renderer).toContain("next.config.navigationLayout === 'sidebar'");
    expect(renderer).toContain('sidebarCollapsed: !previous.config.sidebarCollapsed');
    expect(renderer).toContain('sidebarCollapseButton.hidden = !sidebar;');
    expect(css).toContain(".app[data-navigation-layout='sidebar'][data-sidebar-collapsed='true']");
    expect(css).toContain(".app[data-navigation-layout='sidebar'] > .topbar-shell");
    expect(css).toContain('padding-top: 0;');
    expect(css).toContain('.sidebar-utility-label { display: inline !important; }');
  });

  it('parses nested at-rules plus motion/font shorthands and simple CSS duration/weight vars', () => {
    const fixture = parseCss(':root { --slow: 250ms; --thin: 300; } @media (min-width: 1px) { .fixture { transition-duration: var(--slow); animation: fade 150ms ease; font: var(--thin) 12px sans-serif; } }');
    const fixtureRoot = rootCustomProperties(fixture);
    const rule = fixture.find((candidate) => candidate.selector === '.fixture')!;
    expect(rule.atRules).toEqual(['@media (min-width: 1px)']);
    const transition = rule.declarations.find((declaration) => declaration.property === 'transition-duration')!;
    const font = rule.declarations.find((declaration) => declaration.property === 'font')!;
    expect(motionDurationAudit(transition.property, transition.value, customPropertiesForRule(rule, fixtureRoot))?.durationsMs).toEqual([250]);
    expect(fontWeightAudit(font.property, font.value, customPropertiesForRule(rule, fixtureRoot))?.weights).toEqual([300]);
    expect(motionDurationAudit('transition-duration', '3e2MS', new Map())?.durationsMs).toEqual([300]);
    expect(fontWeightAudit('font', '350.5 12px sans-serif', new Map())?.weights).toEqual([350.5]);
  });

  it('wires policy gates into verify and the macOS packaging preflight', () => {
    expect(packageJson.scripts?.['verify']).toContain('npm run test:policy');
    const packageMac = packageJson.scripts?.['package:mac'] ?? '';
    expect(packageMac).toMatch(/^npm run verify &&/);
    const postVerify = packageMac.replace(/^npm run verify &&\s*/, '');
    expect(postVerify, 'package:mac must not rebuild source after verify; electron-builder must consume the verified out/**').not.toMatch(/(?:npm\s+run\s+build|electron-vite\s+build)/);
  });
});
