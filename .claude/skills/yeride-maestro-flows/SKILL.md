---
name: yeride-maestro-flows
description: Use when writing, editing, or reviewing Maestro E2E flow YAML files for the YeRide mobile app — especially when adding assertions, handling multi-state screens, passing credentials, or running flows from scripts or Claude Code workflows.
---

# YeRide Maestro Flow Authoring

## Overview

Patterns and gotchas for writing robust Maestro flows in this repo. Two rules prevent the most common silent failures: always inject credentials explicitly, and never use double-optional asserts on multi-state screens.

## Core Patterns

### 1. Credential injection — `--env` flags required

Maestro does NOT inherit the shell environment. Every `maestro test` invocation must pass credentials explicitly:

```bash
maestro test \
  --env RIDER_EMAIL=$RIDER_EMAIL \
  --env RIDER_PASSWORD=$RIDER_PASSWORD \
  --env DRIVER_EMAIL=$DRIVER_EMAIL \
  --env DRIVER_PASSWORD=$DRIVER_PASSWORD \
  e2e/maestro/ui-review/keyboard-inputs.yaml
```

Inside a Claude Code workflow script:

```js
`maestro test --env RIDER_EMAIL=$RIDER_EMAIL --env RIDER_PASSWORD=$RIDER_PASSWORD --env DRIVER_EMAIL=$DRIVER_EMAIL --env DRIVER_PASSWORD=$DRIVER_PASSWORD ${flowPath}`;
```

Missing `--env` → silent `${RIDER_EMAIL}` unresolved → sign-in fails with no useful error.

---

### 2. Multi-state screen assertions — `runFlow-when` OR pattern

When a screen has mutually exclusive states (empty vs. ready, no-account vs. enabled), **two `optional: true` asserts give zero coverage** — if the screen crashes or errors, both silently pass.

Use `runFlow: when: notVisible` to implement a real OR:

```yaml
# ✅ CORRECT: fails if screen crashed (neither state visible)
- runFlow:
    when:
      notVisible:
        id: wallet-header-add # ready state
    commands:
      - assertVisible:
          id: wallet-empty-add # empty state (must be there if header-add isn't)
```

Logic: if `wallet-header-add` IS visible → conditional skips → screen is in ready state (valid). If `wallet-header-add` is NOT visible → conditional runs → assert `wallet-empty-add` → if THAT is also absent, test fails (correctly catches crash/error).

For three mutually exclusive states (e.g. DriverEarnings: enabled / pending / no-account):

```yaml
- runFlow:
    when:
      notVisible:
        id: earnings-balance-card # enabled state
    commands:
      - runFlow:
          when:
            notVisible:
              id: earnings-continue-setup # pending state
          commands:
            - assertVisible:
                id: earnings-setup-payouts # no-account state (must be there)
```

**Rule of thumb:** `optional: true` is correct for loading spinners. It is almost never correct for content assertions.

---

### 3. Loading spinner waits

Always use `optional: true` on spinner waits — the spinner may never appear if data is already cached:

```yaml
- extendedWaitUntil:
    notVisible:
      id: wallet-loading-spinner
    timeout: 10000
    optional: true # ✅ correct — spinner may be absent if already loaded
```

Do NOT use `optional: true` on the content assertion that follows.

---

### 4. Relative paths from `e2e/maestro/regression/`

Regression stubs live one level below `e2e/maestro/`. The `_lib/` helper is at `e2e/maestro/_lib/`. From a stub:

```yaml
# ✅ correct from e2e/maestro/regression/
- runFlow: ../_lib/sign-in-as.yaml

# ❌ wrong — resolves to e2e/_lib/ (does not exist)
- runFlow: ../../_lib/sign-in-as.yaml
```

---

## Quick Reference

| Screen               | States                         | Stable testIDs (one per state)                                                 |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| WalletScreen         | empty / ready                  | `wallet-empty-add` / `wallet-header-add`                                       |
| DriverEarningsScreen | no-account / pending / enabled | `earnings-setup-payouts` / `earnings-continue-setup` / `earnings-balance-card` |
| RiderActivityScreen  | any                            | `activity-screen` (root)                                                       |
| DriverActivityScreen | any                            | `driver-activity-screen` (root)                                                |
| RiderHomeScreen      | any                            | `rider-home-where-to`                                                          |
| DriverHomeScreen     | any                            | `driver-home-online-toggle`                                                    |

**Tab point coordinates** (y≈96% across both navigators):

| Tab               | Point     |
| ----------------- | --------- |
| Home              | `12%,96%` |
| Activity          | `37%,96%` |
| Wallet / Earnings | `62%,96%` |
| Profile           | `87%,96%` |

**Sign-in helper:** `e2e/maestro/_lib/sign-in-as.yaml` — takes `EMAIL` and `PASSWORD` env vars. Handles dismissing soft-asks, signing out existing session, erasing fields to avoid concatenation.

---

## Common Mistakes

| Mistake                                                       | Symptom                                         | Fix                                                   |
| ------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Missing `--env` flags on `maestro test`                       | Sign-in fails, `${RIDER_EMAIL}` literal in logs | Add all four `--env` flags to every invocation        |
| Double `optional: true` content asserts                       | Flow always passes even after crashes           | Use `runFlow-when` OR pattern                         |
| `optional: true` on content after `optional: true` on spinner | Content assertion skipped silently              | Only `optional: true` on the spinner wait             |
| `../../_lib/` from regression stub                            | `runFlow` file not found error                  | Use `../_lib/`                                        |
| `tapOn: text` for tab bar on iOS                              | Tap silently misses on iOS                      | Use `_lib/tap-tab.yaml` with `TAB_TEXT` + `TAB_POINT` |
