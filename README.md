# loadbearing

[![npm](https://img.shields.io/npm/v/loadbearing.svg)](https://www.npmjs.com/package/loadbearing)
[![CI](https://github.com/webcoderspeed/loadbearing/actions/workflows/ci.yml/badge.svg)](https://github.com/webcoderspeed/loadbearing/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/loadbearing.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/loadbearing.svg)](https://nodejs.org)

**Measure which sections of your `CLAUDE.md` / `AGENTS.md` actually change your agent's behavior — and which silently cost tokens or even make it *worse* — with the measurement noise floor shown, so you know when to trust the result and when you can't.**

Big, shared, long-lived context files drift. A section added a year ago may now do nothing — or actively *reduce* task success, as multiple 2025–2026 studies on agent context files have found. Static linters only **guess** from text. loadbearing **runs your real tasks** with the full context and with each section removed, and reports what measurably changed.

The honest part is the point: agent runs are non-deterministic (token spend on an *identical* context can swing run to run, sometimes splitting into two behavior modes). loadbearing measures that noise floor first, detects bimodal/failure runs, and says **`insufficient-data`** instead of inventing a confident answer it can't defend.

### Real run — a layered DDD TypeScript service

Profiling a 10-section `CLAUDE.md` on a small DDD task-service (`createTask` use-case, verified by its test suite), Claude Sonnet, 5 trials/variant:

```
noise floor: 1.1% (SOLID) · baseline 28,141 tok · pass 100%

  Architecture & Layering   🟡 cost-only          Sonnet keeps the layers right without the rule
  Naming Conventions        🟡 cost-only
  Testing                   🟡 cost-only
  Deployment & Operations   🟡 cost-only          (filler — never affected the task)
  Changelog Policy          🟡 cost-only
  API Response Envelope     ▦ insufficient-data   bimodal (15k–30k) — two behavior modes, not jitter
  DTO & Serialization       ▦ insufficient-data   bimodal (6k–28k)
  Error Handling            ▦ insufficient-data   bimodal (15k–29k)

  6 sections show no measurable effect · 4 need more trials before a verdict
```

The lesson a static linter can't give you: on a capable model, **most of these "rules" changed nothing measurable** — Sonnet already keeps the DDD layers and naming right without being told. And the sections that *did* move behavior (the response/error contracts) came out **bimodal**, so loadbearing refused to grade them rather than flip a coin. That refusal is the feature.

**Best for:** owners of a large or shared context file on a real codebase with a test suite — a NestJS/DDD monorepo, a team gating a shared `AGENTS.md` in CI — where guessing is expensive and reproducibility matters.

> Not the tool that tells you what to put in your context file. The tool that *measures* whether what's already there earns its place — honestly.

---

## Install

```bash
npm install -g loadbearing
# or run once:
npx loadbearing --help
```

Requires the [`claude`](https://docs.claude.com/claude-code) CLI on your PATH.

## Quick start

```bash
cd your-repo
loadbearing init --from-tests    # scaffolds fixtures from your existing test suite
                                 # (Jest / Vitest / Mocha / node:test) — no hand-authoring
loadbearing profile              # runs the ablation, prints the report,
                                 # writes loadbearing-report.html + .json
```

Want to see the run from the README reproduced? A complete worked example — the
layered DDD service, its `CLAUDE.md`, and the `loadbearing.json` — lives in
[`examples/taskflow-ddd/`](examples/taskflow-ddd). `cd` into it and run
`loadbearing profile`.

Open `loadbearing-report.html` — a single self-contained report card you can screenshot or paste into a PR.

## The fixture suite

loadbearing needs a few **real tasks** with an **objective pass/fail** so it can measure outcomes, not vibes:

```json
{
  "contextFile": "CLAUDE.md",
  "model": "haiku",
  "trials": 5,
  "fixtures": [
    {
      "name": "fix-auth-test",
      "prompt": "Fix the failing test in src/auth.test.ts.",
      "verifyCmd": "npm test -- src/auth.test.ts"
    },
    {
      "name": "add-endpoint",
      "prompt": "Add a GET /health endpoint that returns { ok: true }.",
      "verifyCmd": "npm test -- src/health.test.ts"
    }
  ]
}
```

`verifyCmd` exits `0` on success. Tasks run in your repo; loadbearing hard-resets git state between every run so each starts identical.

## What the verdicts mean

| Label | Meaning |
|---|---|
| 🟢 **load-bearing** | Removing it measurably changed the agent's behavior beyond the noise floor. Keep it. |
| ⚪ **no-measurable-effect** | Its effect is within the noise floor at this power. It may still cost tokens to ship. |
| 🟡 **cost-only** | No measurable behavior change, but it spends input tokens every turn. Candidate to cut. |
| ▦ **insufficient-data** | Runs were too few, too noisy, bimodal, or failure-contaminated to call honestly. Re-run with more trials — never trimmed. |

When the noise floor itself can't be trusted (too few same-context runs, or the ablated variants swing far more than the floor claims), loadbearing reports it as **`UNMEASURED`** and refuses to grade any section against it. That's the feature, not a bug: a rigor tool that hides its own uncertainty is worthless.

## Trim

```bash
loadbearing trim                 # emits CLAUDE.trimmed.md, removing only
                                 # high-confidence no-effect sections
```

Trim is conservative on purpose: a false *keep* is harmless, a false *cut* is not. Review the diff and re-run your tasks before replacing the original.

## How it works

1. **baseline** — run your fixtures with the full context (N trials each)
2. **noise floor** — run the *identical* full context again, to measure run-to-run variance
3. **ablate** — for each section, run with that section removed
4. **classify** — a section is load-bearing only if its token delta clears ~2× the noise band *and* its bootstrap 95% CI excludes zero

Primary signal is **token/cost** (lowest variance, directly attributable). Tests/lint pass-fail gate the suite. We deliberately do **not** judge sections on single-run success — it's too noisy.

## Cost & auth

- With `ANTHROPIC_API_KEY` set, loadbearing runs in `--bare` mode (cleanest baseline) and bills per token.
- With your Claude subscription login, it uses that — and the cost figures shown are **reference only**, not a separate charge.
- A profile is `(2 + sections) × fixtures × trials` agent runs. Start small (`trials: 2`, one fixture) to gauge cost, then scale.

## Caveats (read these)

- Results are specific to **this repo, this task suite, this model version** and will drift as models change. Re-run after upgrades.
- Leave-one-out ablation assumes sections are roughly independent; a section inert alone could matter in combination. The report notes this.
- Section-level, not line-level — line-level is below the noise floor at any affordable trial count.

## Library use

```ts
import { profile, renderHtml, claudeCodeAdapter } from 'loadbearing';

const report = profile({
  repoDir: process.cwd(),
  contextFile: 'CLAUDE.md',
  fixtures: [/* ... */],
  adapter: claudeCodeAdapter,
  model: 'haiku',
  trials: 5,
  budgetUsd: 0.5,
});
```

## Status

Early (v0.1). The Claude Code adapter is the most battle-tested path; Codex/Aider
adapters are stubbed behind a small interface. Results are specific to your repo,
task suite, and model version — re-run after model upgrades. Issues and PRs welcome.

## Links

- Repo: https://github.com/webcoderspeed/loadbearing
- Worked example: [`examples/taskflow-ddd/`](examples/taskflow-ddd)

## License

MIT © [webcoderspeed](https://github.com/webcoderspeed)
