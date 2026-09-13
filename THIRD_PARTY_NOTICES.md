# Third-party notices

## Chat On Steroids adapted components

The following Chat in DaVinci components are adapted from Chat On Steroids:

- `src/main/durable.ts` from COS durable state handling.
- `src/shared/agent-goal-policy.ts` from COS Goal/Loop prompts and structured decision contracts.
- `src/main/agent-goal.ts` from COS Goal/Loop decision normalization and bounded Loop stop-refusal semantics, adapted to CID durable sessions and Resolve completion evidence.
- `src/main/cos-control-tools.ts` from COS `session`, `agents`, `session_finish` tool contracts and exact `x-request-id` correlation semantics, adapted as a fail-closed CID gateway delegate surface.
- `src/cos-host/agents.ts` from COS `src/main/agents.ts`, preserving the current Prime/Worker broker, staged durability and sleeping-worker reuse semantics while removing coding-workspace authority at the CID boundary.
- `src/cos-host/shared/session.ts` and `src/cos-host/shared/input.ts` from the corresponding COS shared contracts required by the broker.
- `src/cos-host/browser-bridge.ts`, `src/cos-host/session-runtime.ts`, `src/cos-host/goal-runtime.ts` and `src/cos-host/continuation-runtime.ts` adapt the COS browser companion, Session/Goal/Loop and Compact & Resume transaction semantics to CID's loopback companion identity and durable store. COS coding filesystem/terminal/plugin authority is intentionally not imported into the CID product surface.

MIT License

Copyright (c) 2026 Chat On Steroids contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
