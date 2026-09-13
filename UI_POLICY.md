# Chat in DaVinci UI policy

This project uses the interface-detail checklist from https://github.com/raunofreiberg/interfaces as an input, not as a web-framework mandate. The product is a macOS Electron application, so rules are classified before they are enforced.

This policy guards the exact current renderer implementation. The forward information architecture is the Agent-native three-pane shared cockpit in `AGENT_SYSTEM_SPEC.md` / `UI_SPEC.md`: CID-owned Codex-style Workspace/Session Sidebar + Conversation backed by COS runtime, plus the four-layer Resolve Artifact Workspace (Context / Active Artifact / Changes·Plan / Evidence·Inspector). Migrating from the current Topbar/peer-page baseline does not authorize weakening these accessibility, interaction or regression rules, and current design exceptions remain pinned until the underlying source is deliberately changed and the exception evidence is reviewed.

## Required

Required rules protect correctness, security, durable state, accessibility semantics or regression safety. They may not be waived merely to preserve implementation convenience.

- Protected workflow mutations for one immutable plan are serialized at the engine boundary.
- Renderer actions with the same semantic action key are coalesced while in flight.
- Persisted-setting failures roll the optimistic control state back to the last confirmed app state.
- Icon-only controls have an explicit accessible name.
- Non-checkbox inputs have an associated label.
- Tunnel/API-key identifiers disable spellcheck/autocomplete as appropriate; Tunnel IDs expose the canonical HTML pattern while backend validation remains authoritative.
- Keyboard focus remains visibly distinguishable.
- Long-lived `will-change` declarations are prohibited.
- Approved release packaging runs the full `verify` gate before packaging work starts.

## Enhancement

Enhancements may add keyboard or semantic capability, but must preserve the existing mouse path, normal layout and normal visual appearance.

- Language menu supports ArrowUp/ArrowDown/Home/End and Escape focus return.
- Workspace navigation exposes the current workspace with `aria-current` and supports ArrowLeft/ArrowRight/Home/End without forcing an inaccurate ARIA tab model across the separate Settings surface.
- Selectable Media rows support ArrowUp/ArrowDown/Home/End in addition to Enter/Space activation.
- Visible keyboard focus is added only to keyboard-focus states.

## Design Exception

Visible or behavioral differences are not changed mechanically. Every deliberate deviation is registered in `UI_POLICY_EXCEPTIONS.json` with a stable id, rule, scope, guarded property, approved current value and an explicit maximum where the rule has a numeric ceiling. Selector-only exceptions are not valid.

Every registered exception must also be consumed by live source evidence. Unknown ids, stale entries, changed properties, changed current values and silently widened exception scopes fail the gate. Updating an approved visual exception therefore requires an explicit policy-file change that can be reviewed alongside the source change.

Examples include the user-approved zoom-notice timing, current topbar material, current settings-icon motion, current numeric spacing, explicit desktop Connect behavior and current error-dialog placement.

## Not applicable

Touch/iOS-only rules, favicon rules, React render-loop rules, autoplay-video rules and server-side authentication redirect rules do not apply to the current macOS Electron product. If the target platform or renderer architecture changes, these classifications must be reviewed.

## Automatic gates

`npm run test:ui-policy` checks static renderer policy and registered exceptions. Its CSS reader follows nested at-rules and checks transition/animation shorthand and duration longhands, font-weight/font shorthand, and simple root or same-rule CSS variables. Unresolved duration math fails closed. Static HTML, statically readable `innerHTML` controls and direct local `document.createElement('button'|'input')` controls are inspected for input labelling and accessible names. Blur declarations and global `window.alert` call identities are pinned to their current exception evidence.

The gate is intentionally a source-level guard, not a browser layout engine or a general TypeScript control-flow analyser. Indirect control factories, runtime-generated selector/property strings and inherited CSS variables outside `:root` or the same rule are not semantically evaluated. Direct unsupported control creation and unresolved motion/font values fail closed where the gate can see them; changes that move UI construction behind an indirect factory require extending the gate before that pattern is accepted.

`npm run test:interaction` checks action coalescing and sequential keyboard navigation primitives.

`npm run test:concurrency` checks protected workflow plan-mutation serialization against durable ledger outcomes.

`npm run test:policy` runs all three policy gates.

`npm run verify` runs typecheck, all policy gates, the existing test suite and the production build.

`npm run package:mac` must begin with `npm run verify`; packaging is blocked when any policy gate fails. The packaging chain must not rebuild application source after `verify`; `electron-builder` consumes the `out/**` produced by the verified production build.
