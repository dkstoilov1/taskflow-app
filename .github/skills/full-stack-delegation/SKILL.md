---
name: full-stack-delegation
description: 'Delegate complex full-stack implementation tasks to two sub-agents, one for backend changes and one for frontend changes. Use when a task requires substantial work on both sides or the user requests backend/frontend delegation. The main agent must explicitly state synchronization needs before dispatch.'
---

# Full-Stack Delegation

Split a complex implementation task into exactly two implementation parts and delegate each to its own sub-agent:

1. **Backend implementation**: server-side changes and their tests and documentation.
2. **Frontend implementation**: client-side changes and their tests and documentation.

The main agent coordinates the approach, shared contracts, dependencies, and final integration. Coordination is not a third implementation part.

## When to Use

- A complex implementation task requires substantial backend and frontend work.
- The user requests separate backend and frontend implementation sub-agents.
- Do not apply this workflow to explanations, reviews, minor edits, or tasks with no meaningful work on one side. Explain when the two-part split does not fit instead of inventing work.

## Procedure

### 1. Understand the task yourself

Read the affected code before planning. Identify the backend endpoints and shared types or schemas, the frontend components that consume them, existing patterns, and component boundaries. Do not delegate the exploration needed to define the split or contract.

- If an ambiguity could change the API or user-visible behavior, ask the user before writing the split plan.
- If one side has no meaningful changes, explain why this two-part workflow does not fit. Handle the actual work without inventing a second part or spawning an agent with nothing to do.

### 2. Write the split plan

Post a concrete split plan in chat with exactly these three sections. Include actual paths, endpoints, and contract types when known; do not invent them:

```markdown
## Split plan: <task>

### Part 1 — Backend
- Goal: <server-side outcome>
- Changes: <endpoints, services, persistence, tests, documentation, and owned files>
- Done when: <observable behavior and verification commands>

### Part 2 — Frontend
- Goal: <client-side outcome>
- Changes: <components, API consumption, state, tests, documentation, and owned files>
- Done when: <observable behavior and verification commands>

### Synchronization
<every applicable point below, or the explicit "none needed" statement and reason>
```

Assign shared implementation artifacts such as generated clients, manifests, and lockfiles to a single implementation agent. The other agent must not edit them concurrently.

### The Synchronization section

This section is mandatory. Before launching either agent, state the decisions both parts depend on, the owner of each shared artifact, and how both agents will work in parallel:

1. **API or shared-data contract:** for each new or changed endpoint, specify the method and path; authentication and authorization behavior; path and query parameters and body fields with types, required values, defaults, ranges, and validation; success status and response types, fields, and nullability; and each error status, when it occurs, and its body.
2. **Approach decisions:** state other shared decisions, such as pagination or caching, loading/empty/error states, naming, environment variables, dependencies, proxying, CORS, serialization, and compatibility.
3. **Ordering and verification:** settle shared contracts and prerequisites before dispatch. If either part cannot verify against the other implementation until it exists, explain how it will proceed and which interim checks it can run, such as builds, type checks, or contract-based mocks. State the final integration checks.

If the parts are independent, explicitly state "Synchronization: none needed" and explain why; final integration remains a checkpoint. Do not leave synchronization implicit or run the agents in sequence.

If a synchronization point is a product or design choice the user should make, ask before delegating. Otherwise choose a sensible approach, state it in the plan, and continue.

### 3. Prepare the shared contract before delegating

Before spawning the agents, the main agent writes or updates the agreed contract in the repository's canonical shared artifact, such as existing API types or a schema. This preparation is coordination, not a third implementation part. If the project has no suitable shared code artifact, record the contract in an appropriate agreed definition or document instead of inventing a stack-specific file.

- Treat the agreed artifact as the single source of truth and tell both agents its location.
- Neither agent edits it independently. If it is wrong or insufficient, the agent stops affected work and reports the issue to the main agent.
- Follow repository conventions and relevant skills. Where shared TypeScript types are imported by a frontend, use type-only imports when appropriate so server code is not bundled.

If no shared contract is needed, state that explicitly rather than creating an unnecessary artifact.

### 4. Spawn both agents in parallel

Use one backend implementation sub-agent and one frontend implementation sub-agent. Prefer suitable custom agents when available; otherwise use `general-purpose` implementation agents. Do not use read-only exploration agents for implementation.

Call the implementation-agent tool twice **in the same message**, in background mode, so both parts run concurrently. They work in the same working tree and edit disjoint files or directories; do not use worktree isolation. Do not run them one after the other.

Give each agent:

- The overall goal and its assigned implementation part.
- Acceptance criteria, owned files, and explicit out-of-scope files.
- The agreed approach and API or shared-data contract.
- Dependencies and synchronization checkpoints, including when to stop and report a blocker.
- Existing repository instructions, relevant skills, and testing commands.
- A requirement to implement the changes, not merely recommend them.
- A requirement to report changed files, tests and results, contract deviations, and remaining blockers.

Do not let either agent spawn additional agents. Use default model and reasoning settings unless the user explicitly specifies otherwise.

To make parallel execution possible:

- Settle every shared contract and prerequisite before dispatch, so neither agent waits for the other's output.
- Keep file ownership non-overlapping.
- Have each agent work against the agreed contract rather than the other agent's code. For example, the frontend uses mocks that follow the API contract until the backend is ready.
- Never let an agent implement against an invented contract. If a dependency can't be settled up front, resolve it with the user before dispatch rather than running the agents in sequence.

Each prompt must stand alone; do not assume the agent has this conversation. Use this template, filling in one part:

```text
You are implementing the <BACKEND | FRONTEND> part of a full-stack task in <project>
(<absolute repository path>). Another agent is implementing the other part at the same time.

## Overall task
<One-paragraph summary of the complete feature and its context>

## Your part
<The Part 1 or Part 2 section of the split plan, verbatim>

## Synchronization (fixed; do not deviate)
<The Synchronization section of the split plan, verbatim>
<The agreed contract artifact and relevant types or definitions, or state that none is needed.>

## Boundaries
- Edit only <owned files/directories>. Do not touch the other agent's files or any shared contract artifact.
- If the contract or an agreed decision is wrong, ambiguous, or blocks you, STOP and report what needs to change and why. Do not work around it or invent a replacement.
- Do not commit, push, install packages not listed in the plan, or perform unrelated changes.

## Conventions
- Read and follow <repository instructions and relevant skills>.

## Verify
Run <appropriate tests, type checks, and builds> and fix failures caused by your changes.

## Report back
1. Files changed, one line each on what changed.
2. Verification commands and results, including any failures that remain.
3. Deviations from the plan, contract issues, and blockers; say "none" if none.
```

### 5. Act as the hub while they work

Keep independent work moving while agents run. Wait for completion notifications and retrieve results through the available agent tools; do not repeatedly poll or duplicate delegated implementation.

The agents cannot coordinate assumptions implicitly: route contract questions and cross-part blockers through the main agent. If a contract or approach change is needed:

1. Decide the change, asking the user if it is a product decision.
2. Update the canonical contract artifact and the synchronization section.
3. State the revised agreement and its impact, then send it to both agents before either implements it. If an agent has finished, continue that same agent for the follow-up.

Never let one agent's local workaround silently change what the other agent relies on. Pause only work affected by the unresolved change; the other agent continues unaffected work.

Use the original agents for same-task follow-ups and corrections. Do not add a third implementation agent. Respect file ownership and avoid concurrent edits to shared artifacts.

If delegation is unavailable or an agent fails, report the limitation and affected part. Do not pretend the work was delegated or silently replace this workflow with direct implementation.

### 6. Integrate and verify

After both agents finish, the main agent checks the combined result against the plan and original acceptance criteria:

- Confirm the frontend consumes the actual backend contract, including errors and authentication.
- Review the integrated diff against the plan: verify endpoint paths, parameters, status codes, response shapes, and frontend handling of documented errors.
- Run the smallest existing checks covering both parts and their integration; verify builds and type compatibility where applicable.
- Test the required end-to-end behavior, not just each side in isolation. When the environment permits, run both applications and exercise the feature; use browser validation when useful for UI behavior.
- Fix small integration gaps yourself after the relevant agent has stopped editing; for larger issues, continue the owning agent with the exact problem. Repeat affected checks.
- Report any verification that could not be completed. Neither two successful agent reports nor mocked frontend responses alone prove end-to-end success.

Then report what each part changed, the final contract and synchronization decisions, deviations from the plan, verification results, and anything that could not be verified or remains blocked.
