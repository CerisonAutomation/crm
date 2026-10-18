# Agent Rules — Laziness Ladder & Simplicity Principles

> Adapted from [Ponytail](https://github.com/DietrichGebert/ponytail) (MIT License)
> and [Karpathy Ponytail Skills](https://github.com/AbdullahHameedKhan/karpathy-ponytail-skills)

## The Laziness Ladder

**The best code is the code never written.**

Before writing any code, stop at the first rung that holds:

1. **Does this need to exist at all?** (YAGNI) — Skip features, options and flexibility nobody asked for.
2. **Already in this codebase?** — Reuse the helper, util, or pattern that's already here.
3. **Standard library?** — Use it, unless the project has its own.
4. **Native platform feature?** — Use it.
5. **Installed dependency?** — Use it. Never add a dependency for a few lines.
6. **Can this be one line?** — Make it one line.
7. **Only then:** Write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

## Core Principles

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- **Deletion over addition.** Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
- The smallest change in the wrong place isn't lazy, it's a second bug.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

**The test:** Every changed line should trace directly to the user's request.

### 4. Bug Fixes

**Root cause, not symptom.**

A report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller.

### 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"

## What Is Never Lazy

**Lazy about the solution, never about the change itself.**

Never cut:
- Validation at trust boundaries
- Error handling that prevents data loss
- Security
- Accessibility
- The calibration real hardware needs
- Anything the user asked for

## Testing

**Lazy code without its check is unfinished.**

New non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.

## Comments

**Comment only the why the code cannot show, in one line.**

Mark intentional simplifications with a `ponytail:` comment. If the shortcut has a known ceiling (global lock, O(n²) scan, naive heuristic), the comment names the ceiling and the upgrade path.

## Intensity Levels

| Level | What changes |
|-------|-------------|
| **lite** | Build what's asked, but name the lazier alternative in one line. User picks. |
| **full** | The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation. Default. |
| **ultra** | YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same breath. |

## Application to Citizen Lane Agent Platform

These principles apply to the agent platform in specific ways:

### Agent Development
- **Reuse existing agents** before creating new ones. Check the registry first.
- **One agent per responsibility** — don't create god-agents that do everything.
- **Minimum tools** — only declare tools the agent actually needs.
- **Bounded context** — pass only the context the agent needs, not everything.

### Tool Development
- **Check existing tools** before creating new ones.
- **One tool per action** — don't create mega-tools with flags.
- **Minimal parameters** — only expose what's needed.
- **Clear side effects** — declare what the tool can do.

### Workflow Development
- **Simplest pattern first** — sequential before parallel, parallel before critic loop.
- **Minimum agents** — don't add agents "just in case".
- **Deterministic first** — use deterministic code where possible, agents for ambiguity.

### Code Quality
- **No speculative abstractions** — don't add interfaces "for future use".
- **No premature optimization** — keep it simple until proven slow.
- **No dead code** — delete unused code, don't comment it out.
