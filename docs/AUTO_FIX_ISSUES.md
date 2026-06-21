# Auto-Reproduce & Fix Issues

An automated agent that runs on **every newly opened GitHub issue**,
triages it, tries to reproduce the reported bug with a headless test,
and — only when it reproduces — implements a minimal fix and opens a
pull request.

- **Workflow:** [`.github/workflows/auto-fix-issues.yml`](../.github/workflows/auto-fix-issues.yml)
- **Trigger:** `issues: [opened]`
- **Engine:** [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action)

## What it does

When an issue is opened, the workflow:

1. **Checks out** the repo and runs `npm ci` (Node from `.nvmrc`).
2. **Runs the Claude Code agent** with a fixed procedure (see below).
3. **Opens a PR** via a Personal Access Token — but **only if the agent
   actually pushed commits**.

### The agent's procedure (the `prompt`)

| Step                   | Behavior                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. **Triage**          | Is this a _reproducible software bug_ (not a feature request, question, idea, or spam)? If not → comment on the issue explaining why, then **stop**. No files changed. |
| 2. **Reproduce**       | Add a focused **failing Jest test** under the relevant `src/**/__tests__/` that demonstrates the bug, and confirm it fails via `npm test`.                             |
| 3. **Can't reproduce** | Comment describing exactly what was tried and observed, then **stop**. No files changed.                                                                               |
| 4. **Fix**             | Implement the _minimal_ fix that makes the reproduction test pass, following `CLAUDE.md` conventions (Result over throw, layer boundaries, `@shared/logger`, …).       |
| 5. **Verify**          | Run `npm run verify` (typecheck + lint + format:check + tests) and make it pass. Keep the new test.                                                                    |
| 6. **Commit**          | Commit on a new branch referencing the issue number. The agent does **not** open the PR — a later workflow step does.                                                  |

So a single opened issue has three possible outcomes:

- **Reproducible bug** → failing test + fix pushed → **PR opened**, existing `CI` runs on it.
- **Not a bug** (feature/question/spam) → **issue comment**, no PR.
- **Bug but not reproducible** → **issue comment** with findings, no PR.

## Why reproduction is Jest-only

This is an Expo / React-Native app. Maestro E2E flows
(`e2e/maestro/**`) need a booted simulator/emulator and **cannot run on
a GitHub Actions ubuntu runner**. The agent is therefore instructed to
reproduce strictly through headless `npm test`. Bugs that only manifest
in the live UI won't be reproducible here — expect a "could not
reproduce" comment for those.

## Why a PAT opens the PR

GitHub deliberately **does not trigger other workflows** for a PR opened
by the default `GITHUB_TOKEN`. If the bot opened its PR with that token,
the existing `CI` (`verify`) job in
[`ci.yml`](../.github/workflows/ci.yml) would **not** run on it — so the
fix would land unverified.

The final step instead opens the PR with **`REPO_PAT`** (a Personal
Access Token), which is attributed to a real user, so `CI` fires
normally and verifies the fix before you merge.

The PR step is **double-gated** so no empty PR is ever created:

```bash
if: steps.claude.outputs.branch_name != ''        # action produced a branch
...
AHEAD="$(git rev-list --count origin/main..origin/$BRANCH)"
if [ "$AHEAD" -eq 0 ]; then exit 0; fi            # branch has real commits
```

## Setup

The workflow is live on `main`, but it needs two repository secrets to
function.

### 1. `CLAUDE_CODE_OAUTH_TOKEN` — agent auth (subscription)

Uses a Claude Pro/Max subscription rather than API billing. Generate
locally and store it:

```bash
claude setup-token                                          # prints an OAuth token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo yeapptech/yeride-mobile
```

> ⚠️ **This token expires periodically** and must be regenerated with
> `claude setup-token`, then re-set. When it lapses, the "Run Claude Code
> agent" step fails — that's the symptom of an expired token.

### 2. `REPO_PAT` — opens the PR so CI runs

A Personal Access Token. Either form works:

- **Classic** (`https://github.com/settings/tokens`): scopes `repo` + `workflow`.
- **Fine-grained** (`https://github.com/settings/tokens?type=beta`): repo
  `yeride-mobile`, with **Contents**, **Pull requests**, and **Issues** set
  to _Read and write_. (Org may require admin approval.)

```bash
gh secret set REPO_PAT --repo yeapptech/yeride-mobile
```

### Optional — the `auto-fix` label

The PR step adds an `auto-fix` label. Create it once, or the flag is a
no-op warning:

```bash
gh label create auto-fix --repo yeapptech/yeride-mobile --color FBCA04
```

### Verify secrets

```bash
gh secret list --repo yeapptech/yeride-mobile
# expect: CLAUDE_CODE_OAUTH_TOKEN, REPO_PAT
```

## Safety rails

- **Triage gate** — non-bug issues never produce a PR, only a comment.
- **Double-gated PR** — no commits, no PR.
- **Repo hooks apply** — Claude Code honors `.claude/settings.json`, so
  the agent is blocked from editing `.env*` / Firebase config
  (`guard-secrets.mjs`) and from violating the console / layer
  conventions (`block-conventions.mjs`).
- **`--max-turns 30`** bounds the agent's work (and cost) per run.
- **`concurrency`** keyed per issue number prevents duplicate parallel runs.
- **CI on the PR** — the fix is verified by the standard `verify` job
  before a human merges.

## Cost & scope note

This runs an autonomous, write-capable agent on **every** opened issue.
The triage step keeps non-bugs cheap, but high issue volume means real
token cost. To make it opt-in instead, change the trigger to
`types: [labeled]` and add an `if:` guard on the label — a one-line
change in the workflow.

## Testing it

1. Open a small issue describing a genuinely reproducible bug in a pure
   domain function (e.g. a `Money` / `FareCalculator` edge case).
2. Watch the run: `gh run watch` (or the repo Actions tab).
3. Expect a failing reproduction test, a fix, an `Auto-fix:` PR, and the
   `CI` workflow running on that PR.
4. Sanity-check the triage path with a feature-request issue — expect a
   comment and **no PR**.

## Troubleshooting

| Symptom                                        | Likely cause                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| "Run Claude Code agent" step fails immediately | `CLAUDE_CODE_OAUTH_TOKEN` missing or expired → re-run `claude setup-token` and re-set the secret.              |
| Agent runs but PR step is skipped              | No commits were pushed — agent triaged it as a non-bug or couldn't reproduce. Check the issue for its comment. |
| PR opens but `CI` doesn't run on it            | `REPO_PAT` missing/invalid, so the PR fell back to a token that can't trigger workflows.                       |
| `auto-fix` label warning in the PR step        | Label doesn't exist — create it or drop the `--label` flag.                                                    |
| Bug not reproduced when it clearly exists      | It only manifests in the live UI (Maestro territory), not in headless Jest.                                    |
