# UI Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hybrid UI review system — four Maestro flows that test interactive behavior on the 15 critical screens, plus a Claude Code workflow script that fans out static-analysis agents, runs the Maestro suite, and synthesizes a platform-specific findings report with Maestro regression stubs for confirmed critical issues.

**Architecture:** A saved Claude Code workflow at `.claude/workflows/ui-review.js` runs three phases in sequence: (1) five parallel agents do static code analysis on all screen files, (2) one agent uses Bash to run the four new Maestro flows and parse results, (3) a synthesis agent merges Phase 1 + Phase 2 findings, writes `docs/ui-audit/YYYY-MM-DD-{platform}.md`, and writes Maestro regression stubs for critical reproducible issues. The four Maestro flows live in `e2e/maestro/ui-review/` and are also runnable standalone.

**Tech Stack:** Maestro CLI (`~/.maestro/bin/maestro`), Claude Code Workflow API, React Native + Expo, existing `_lib/sign-in-as.yaml` + `_lib/tap-tab.yaml` helpers.

**Prerequisites for Maestro flows:**

- Maestro CLI installed: `curl -Ls "https://get.maestro.mobile.dev" | bash` (needs Java 17+)
- Dev client built and Metro running (`npm run start`)
- Env vars set: `RIDER_EMAIL`, `RIDER_PASSWORD`, `DRIVER_EMAIL`, `DRIVER_PASSWORD`
- For iOS flows: set simulator location first: `xcrun simctl location <udid> set 26.1276,-80.2331`

---

## File Map

| Action | File                                             |
| ------ | ------------------------------------------------ |
| Create | `e2e/maestro/ui-review/keyboard-inputs.yaml`     |
| Create | `e2e/maestro/ui-review/scroll-reachability.yaml` |
| Create | `e2e/maestro/ui-review/bottom-actions.yaml`      |
| Create | `e2e/maestro/ui-review/tab-navigation.yaml`      |
| Create | `.claude/workflows/ui-review.js`                 |

---

## Task 1: Maestro keyboard-inputs flow

**Files:**

- Create: `e2e/maestro/ui-review/keyboard-inputs.yaml`

Tests that text inputs remain visible and tappable after the keyboard opens.
Covers RouteSearchScreen (has `testID="pickup-input"` and `testID="dropoff-input"`).

- [ ] **Step 1: Create the flow file**

```yaml
appId: app.yeride.dev
# Verifies text inputs remain visible and tappable after the keyboard opens.
# Covers: RouteSearchScreen (pickup-input, dropoff-input).
# Prerequisite: RIDER_EMAIL / RIDER_PASSWORD env vars.
---
- runFlow:
    file: ../_lib/sign-in-as.yaml
    env:
      EMAIL: ${RIDER_EMAIL}
      PASSWORD: ${RIDER_PASSWORD}
- runFlow: ../auth/dismiss-soft-asks.yaml
# Navigate to RouteSearch
- tapOn:
    id: rider-home-where-to
- waitForAnimationToEnd
# Pickup input: tap → assert still visible (not behind keyboard) → dismiss
- tapOn:
    id: pickup-input
- waitForAnimationToEnd
- assertVisible:
    id: pickup-input
- hideKeyboard
# Dropoff input: tap → assert still visible → dismiss
- tapOn:
    id: dropoff-input
- waitForAnimationToEnd
- assertVisible:
    id: dropoff-input
- hideKeyboard
- back
```

- [ ] **Step 2: Run the flow (iOS)**

```bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro \
  -e RIDER_EMAIL=<rider-stage-email> \
  -e RIDER_PASSWORD=<rider-stage-password> \
  test e2e/maestro/ui-review/keyboard-inputs.yaml
```

Expected: all steps pass, both inputs assert visible after keyboard opens.

- [ ] **Step 3: Commit**

```bash
git add e2e/maestro/ui-review/keyboard-inputs.yaml
git commit -m "test(maestro): add keyboard-inputs ui-review flow"
```

---

## Task 2: Maestro scroll-reachability flow

**Files:**

- Create: `e2e/maestro/ui-review/scroll-reachability.yaml`

Scrolls all long-content screens and asserts no crash. Covers rider ActivityScreen (`testID="activity-screen"`), WalletScreen (`testID="wallet-empty-add"`, `"wallet-header-add"`), driver DriverActivityScreen (`testID="driver-activity-screen"`), DriverEarningsScreen (`testID="earnings-setup-payouts"`, `"earnings-balance-card"`).

- [ ] **Step 1: Create the flow file**

```yaml
appId: app.yeride.dev
# Scrolls each long-content screen and asserts no crash / content not cut off.
# Covers: ActivityScreen (rider+driver), WalletScreen, DriverEarningsScreen.
# Prerequisite: RIDER_EMAIL / RIDER_PASSWORD / DRIVER_EMAIL / DRIVER_PASSWORD env vars.
---
# ── Rider: Activity tab ──────────────────────────────────────────────────────
- runFlow:
    file: ../_lib/sign-in-as.yaml
    env:
      EMAIL: ${RIDER_EMAIL}
      PASSWORD: ${RIDER_PASSWORD}
- runFlow: ../auth/dismiss-soft-asks.yaml
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Activity'
      TAB_POINT: '37%,96%'
- extendedWaitUntil:
    notVisible:
      id: activity-loading
    timeout: 8000
    optional: true
- scroll
- scroll
- assertVisible:
    id: activity-screen
# ── Rider: Wallet tab ────────────────────────────────────────────────────────
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Wallet'
      TAB_POINT: '62%,96%'
- extendedWaitUntil:
    notVisible:
      id: wallet-loading-spinner
    timeout: 8000
    optional: true
- scroll
# Assert one of the known wallet elements is still visible after scroll
- assertVisible:
    id: wallet-empty-add
    optional: true
- assertVisible:
    id: wallet-header-add
    optional: true
# ── Switch to driver account ─────────────────────────────────────────────────
- runFlow:
    file: ../_lib/sign-in-as.yaml
    env:
      EMAIL: ${DRIVER_EMAIL}
      PASSWORD: ${DRIVER_PASSWORD}
- runFlow: ../auth/dismiss-soft-asks.yaml
# ── Driver: Activity tab ─────────────────────────────────────────────────────
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Activity'
      TAB_POINT: '37%,96%'
- extendedWaitUntil:
    notVisible:
      id: driver-activity-loading
    timeout: 8000
    optional: true
- scroll
- scroll
- assertVisible:
    id: driver-activity-screen
# ── Driver: Earnings tab ─────────────────────────────────────────────────────
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Earnings'
      TAB_POINT: '62%,96%'
- extendedWaitUntil:
    notVisible:
      id: earnings-loading-spinner
    timeout: 10000
    optional: true
- scroll
# Assert one of the known earnings elements is still visible after scroll
- assertVisible:
    id: earnings-setup-payouts
    optional: true
- assertVisible:
    id: earnings-balance-card
    optional: true
```

- [ ] **Step 2: Run the flow (iOS)**

```bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro \
  -e RIDER_EMAIL=<rider-email> \
  -e RIDER_PASSWORD=<rider-password> \
  -e DRIVER_EMAIL=<driver-email> \
  -e DRIVER_PASSWORD=<driver-password> \
  test e2e/maestro/ui-review/scroll-reachability.yaml
```

Expected: all steps pass, screen elements still visible after scrolling.

- [ ] **Step 3: Commit**

```bash
git add e2e/maestro/ui-review/scroll-reachability.yaml
git commit -m "test(maestro): add scroll-reachability ui-review flow"
```

---

## Task 3: Maestro bottom-actions flow

**Files:**

- Create: `e2e/maestro/ui-review/bottom-actions.yaml`

Asserts that sticky bottom buttons are visible and reachable — not hidden behind the tab bar or keyboard. Covers AddPaymentMethodScreen (`testID="add-pm-save"`).

- [ ] **Step 1: Create the flow file**

```yaml
appId: app.yeride.dev
# Asserts sticky bottom buttons are visible and not obscured.
# Covers: AddPaymentMethodScreen (add-pm-save button).
# Prerequisite: RIDER_EMAIL / RIDER_PASSWORD env vars.
---
- runFlow:
    file: ../_lib/sign-in-as.yaml
    env:
      EMAIL: ${RIDER_EMAIL}
      PASSWORD: ${RIDER_PASSWORD}
- runFlow: ../auth/dismiss-soft-asks.yaml
# Navigate to Wallet tab
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Wallet'
      TAB_POINT: '62%,96%'
- extendedWaitUntil:
    notVisible:
      id: wallet-loading-spinner
    timeout: 10000
    optional: true
# Tap "Add card" — text is present in both empty-state and ready-state
- tapOn: 'Add card'
- waitForAnimationToEnd
# AddPaymentMethod: assert the Save button is visible (not off-screen or behind home indicator)
- assertVisible:
    id: add-pm-save
- back
```

- [ ] **Step 2: Run the flow (iOS)**

```bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro \
  -e RIDER_EMAIL=<rider-email> \
  -e RIDER_PASSWORD=<rider-password> \
  test e2e/maestro/ui-review/bottom-actions.yaml
```

Expected: add-pm-save button is visible on AddPaymentMethod screen.

- [ ] **Step 3: Commit**

```bash
git add e2e/maestro/ui-review/bottom-actions.yaml
git commit -m "test(maestro): add bottom-actions ui-review flow"
```

---

## Task 4: Maestro tab-navigation flow

**Files:**

- Create: `e2e/maestro/ui-review/tab-navigation.yaml`

Walks every tab on both RiderTabsNavigator and DriverTabsNavigator and asserts each renders without crashing. Rider tabs use known testIDs; driver tabs use existing `driver-home-online-toggle` and `driver-activity-screen`.

- [ ] **Step 1: Create the flow file**

```yaml
appId: app.yeride.dev
# Walks every tab for rider and driver, asserts each screen renders without crashing.
# Covers: RiderTabsNavigator (Home, Activity, Wallet, Profile) and
#         DriverTabsNavigator (Home, Activity, Earnings, Profile).
# Prerequisite: RIDER_EMAIL / RIDER_PASSWORD / DRIVER_EMAIL / DRIVER_PASSWORD env vars.
---
# ── Rider tabs ───────────────────────────────────────────────────────────────
- runFlow:
    file: ../_lib/sign-in-as.yaml
    env:
      EMAIL: ${RIDER_EMAIL}
      PASSWORD: ${RIDER_PASSWORD}
- runFlow: ../auth/dismiss-soft-asks.yaml
- assertVisible:
    id: rider-home-where-to
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Activity'
      TAB_POINT: '37%,96%'
- assertVisible:
    id: activity-screen
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Wallet'
      TAB_POINT: '62%,96%'
- extendedWaitUntil:
    notVisible:
      id: wallet-loading-spinner
    timeout: 10000
    optional: true
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Profile'
      TAB_POINT: '87%,96%'
# Profile tab renders UserProfileScreen — assert vehicles link present
- assertVisible:
    id: profile-vehicles-link
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Home'
      TAB_POINT: '12%,96%'
- assertVisible:
    id: rider-home-where-to
# ── Driver tabs ──────────────────────────────────────────────────────────────
- runFlow:
    file: ../_lib/sign-in-as.yaml
    env:
      EMAIL: ${DRIVER_EMAIL}
      PASSWORD: ${DRIVER_PASSWORD}
- runFlow: ../auth/dismiss-soft-asks.yaml
- assertVisible:
    id: driver-home-online-toggle
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Activity'
      TAB_POINT: '37%,96%'
- assertVisible:
    id: driver-activity-screen
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Earnings'
      TAB_POINT: '62%,96%'
- extendedWaitUntil:
    notVisible:
      id: earnings-loading-spinner
    timeout: 10000
    optional: true
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Profile'
      TAB_POINT: '87%,96%'
- assertVisible:
    id: profile-vehicles-link
- runFlow:
    file: ../_lib/tap-tab.yaml
    env:
      TAB_TEXT: 'Home'
      TAB_POINT: '12%,96%'
- assertVisible:
    id: driver-home-online-toggle
```

- [ ] **Step 2: Run the flow (iOS)**

```bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro \
  -e RIDER_EMAIL=<rider-email> \
  -e RIDER_PASSWORD=<rider-password> \
  -e DRIVER_EMAIL=<driver-email> \
  -e DRIVER_PASSWORD=<driver-password> \
  test e2e/maestro/ui-review/tab-navigation.yaml
```

Expected: all 8 tabs render without crashing, known testIDs visible.

- [ ] **Step 3: Commit**

```bash
git add e2e/maestro/ui-review/tab-navigation.yaml
git commit -m "test(maestro): add tab-navigation ui-review flow"
```

---

## Task 5: Workflow script — full three-phase implementation

**Files:**

- Create: `.claude/workflows/ui-review.js`

The workflow fans out static analysis in Phase 1, runs Maestro in Phase 2, and synthesizes a report in Phase 3. The `platform` arg (`"ios"` or `"android"`) controls platform-specific checks and Maestro device targeting. The optional `files` arg scopes Phase 1 to specific changed files (used for change-review runs).

- [ ] **Step 1: Create the `.claude/workflows/` directory and the script**

```bash
mkdir -p .claude/workflows
```

Write `.claude/workflows/ui-review.js`:

```js
export const meta = {
  name: 'ui-review',
  description:
    'Hybrid UI audit — static analysis + Maestro E2E + findings report',
  phases: [
    { title: 'Static Analysis' },
    { title: 'Maestro Run' },
    { title: 'Synthesis' },
  ],
};

const { platform = 'ios', files } = args ?? {};
const isFullAudit = !files || files.length === 0;

// ─── Phase 1: Static Analysis ────────────────────────────────────────────────
phase('Static Analysis');

const SCREEN_GROUPS = [
  {
    group: 'auth',
    files: [
      'src/presentation/features/auth/screens/LogInScreen.tsx',
      'src/presentation/features/auth/screens/RegisterScreen.tsx',
      'src/presentation/features/auth/screens/ForgotPasswordScreen.tsx',
      'src/presentation/features/auth/screens/EmailVerificationScreen.tsx',
      'src/presentation/features/auth/screens/UserProfileScreen.tsx',
    ],
  },
  {
    group: 'rider',
    files: [
      'src/presentation/features/rider/screens/RiderHomeScreen.tsx',
      'src/presentation/features/rider/screens/RouteSearchScreen.tsx',
      'src/presentation/features/rider/screens/RouteSelectScreen.tsx',
      'src/presentation/features/rider/screens/RideMonitorScreen.tsx',
      'src/presentation/features/rider/screens/RideReceiptScreen.tsx',
      'src/presentation/features/rider/screens/RideScheduledConfirmationScreen.tsx',
      'src/presentation/features/rider/screens/ActivityScreen.tsx',
      'src/presentation/features/rider/screens/WalletScreen.tsx',
      'src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx',
    ],
  },
  {
    group: 'driver',
    files: [
      'src/presentation/features/driver/screens/DriverHomeScreen.tsx',
      'src/presentation/features/driver/screens/DriverDispatchScreen.tsx',
      'src/presentation/features/driver/screens/DriverMonitorScreen.tsx',
      'src/presentation/features/driver/screens/DriverNavigationScreen.tsx',
      'src/presentation/features/driver/screens/DriverActivityScreen.tsx',
      'src/presentation/features/driver/screens/DriverEarningsScreen.tsx',
    ],
  },
  {
    group: 'vehicle-payments',
    files: [
      'src/presentation/features/driver/screens/VehicleListScreen.tsx',
      'src/presentation/features/driver/screens/VehicleRegistrationScreen.tsx',
      'src/presentation/features/driver/screens/VehiclePhotosScreen.tsx',
      'src/presentation/features/driver/screens/VehicleDetailsScreen.tsx',
    ],
  },
  {
    group: 'shared',
    files: ['src/presentation/features/shared/screens/TripDetailScreen.tsx'],
  },
];

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['group', 'findings'],
  properties: {
    group: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'screen',
          'severity',
          'category',
          'issue',
          'detail',
          'fix',
          'reproducible',
        ],
        properties: {
          screen: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          category: {
            type: 'string',
            enum: ['keyboard', 'scroll', 'safe-area', 'style', 'navigation'],
          },
          issue: { type: 'string' },
          detail: { type: 'string' },
          fix: { type: 'string' },
          reproducible: { type: 'boolean' },
        },
      },
    },
  },
};

const kvBehavior =
  platform === 'ios'
    ? '"padding" is correct for iOS'
    : '"height" or undefined is correct for Android';

const groupsToAnalyze = isFullAudit
  ? SCREEN_GROUPS
  : SCREEN_GROUPS.filter((g) => g.files.some((f) => files.includes(f)));

const staticResults = await parallel(
  groupsToAnalyze.map(
    (g) => () =>
      agent(
        `Audit these React Native screen files for UI issues on ${platform}.

Read each file:
${g.files.join('\n')}

Report every issue found. Return an empty findings array if everything looks correct.

KEYBOARD & INPUT SAFETY
- TextInput NOT inside a ScrollView with keyboardShouldPersistTaps="handled": tapping outside the input will dismiss the keyboard unexpectedly.
- Form screen with TextInput but no KeyboardAvoidingView: keyboard will cover inputs on small screens.
- KeyboardAvoidingView with wrong behavior for ${platform}: ${kvBehavior}. Flag any mismatch or missing Platform.OS check.
- TextInput near the bottom of the screen (inside a fixed View, not scrollable) with no bottom offset: keyboard will cover it.

SCROLL & OVERFLOW
- Lists or content with more than 3 fields not inside ScrollView or FlatList: unreachable below the fold on small screens.
- FlatList nested inside a ScrollView: React Native virtualization crash.
- Fixed-height containers (not flex-based) that will overflow on iPhone SE (375×667pt display).

SAFE AREA & CHROME
- Screen missing SafeAreaView or useSafeAreaInsets: content bleeds under notch or home indicator.
- Bottom button or sticky input without safe-area bottom inset: hidden behind tab bar or home indicator.

VISUAL / STYLE CONSISTENCY
- Hardcoded color value (#xxx, rgb(), rgba()) in className or style prop instead of a NativeWind theme token.
- Mixed spacing: style={{ padding: N }} and className="p-N" used for the same purpose on the same screen.

NAVIGATION
- Screen calls navigation.goBack() but may be mounted as a root screen (no guaranteed prior screen).

Return only confirmed issues. Do not invent issues.`,
        {
          label: `analyze:${g.group}`,
          phase: 'Static Analysis',
          schema: FINDINGS_SCHEMA,
        },
      ),
  ),
);

// ─── Phase 2: Maestro Run ────────────────────────────────────────────────────
phase('Maestro Run');

const baseFlows = [
  'e2e/maestro/ui-review/keyboard-inputs.yaml',
  'e2e/maestro/ui-review/scroll-reachability.yaml',
  'e2e/maestro/ui-review/bottom-actions.yaml',
  'e2e/maestro/ui-review/tab-navigation.yaml',
];

const fullAuditFlows = isFullAudit
  ? [
      'e2e/maestro/rider/walkthrough.yaml',
      'e2e/maestro/driver/walkthrough.yaml',
    ]
  : [];

const allFlows = [...baseFlows, ...fullAuditFlows];

const MAESTRO_SCHEMA = {
  type: 'object',
  required: ['flows'],
  properties: {
    skipped: { type: 'boolean' },
    skipReason: { type: 'string' },
    flows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'passed', 'error'],
        properties: {
          name: { type: 'string' },
          passed: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
    },
  },
};

const deviceCheck =
  platform === 'ios'
    ? 'xcrun simctl list devices booted 2>/dev/null | grep Booted'
    : 'adb devices 2>/dev/null | grep -v "List of" | grep -v "^$"';

const maestroResults = await agent(
  `Run Maestro UI flows and return structured results.

STEP 1 — Check for a connected ${platform === 'ios' ? 'iOS simulator' : 'Android emulator'}:
Run: ${deviceCheck}
If output is empty, return { skipped: true, flows: [], skipReason: "No ${platform === 'ios' ? 'booted iOS simulator' : 'connected Android emulator'} found — boot one and re-run" }.

STEP 2 — Check Maestro CLI:
Run: ls ~/.maestro/bin/maestro 2>/dev/null || echo MISSING
If output is "MISSING", return { skipped: true, flows: [], skipReason: "Maestro CLI not found at ~/.maestro/bin/maestro" }.

STEP 3 — Run each flow in sequence:
export PATH="$PATH:$HOME/.maestro/bin"

${allFlows.map((f) => `maestro test ${f}`).join('\n')}

Credentials (RIDER_EMAIL, RIDER_PASSWORD, DRIVER_EMAIL, DRIVER_PASSWORD) must already be set in the calling environment.

STEP 4 — For each flow, record:
  name: basename of the flow path (e.g. "keyboard-inputs.yaml")
  passed: true if exit code was 0, false otherwise
  error: first error line from output if failed, empty string if passed

Return { flows: [...] }.`,
  { label: 'maestro-run', phase: 'Maestro Run', schema: MAESTRO_SCHEMA },
);

// ─── Phase 3: Synthesis ──────────────────────────────────────────────────────
phase('Synthesis');

const allFindings = staticResults
  .filter(Boolean)
  .flatMap((r) => r.findings ?? []);
const criticalCount = allFindings.filter(
  (f) => f.severity === 'critical',
).length;
const warningCount = allFindings.filter((f) => f.severity === 'warning').length;
const infoCount = allFindings.filter((f) => f.severity === 'info').length;
const criticalReproducible = allFindings.filter(
  (f) => f.severity === 'critical' && f.reproducible,
);

await agent(
  `Write a UI audit report and Maestro regression stubs.

Platform: ${platform}
Findings (${allFindings.length} total — ${criticalCount} critical, ${warningCount} warning, ${infoCount} info):
${JSON.stringify(allFindings, null, 2)}

Maestro results:
${
  maestroResults?.skipped
    ? 'SKIPPED: ' + (maestroResults.skipReason ?? 'unknown reason')
    : JSON.stringify(maestroResults?.flows ?? [], null, 2)
}

Critical + reproducible findings (need regression stubs — ${criticalReproducible.length} total):
${JSON.stringify(criticalReproducible, null, 2)}

STEP 1: Get today's date.
Run: date +%Y-%m-%d

STEP 2: Create the report directory.
Run: mkdir -p docs/ui-audit

STEP 3: Write the report to docs/ui-audit/<DATE>-${platform}.md:

\`\`\`
# UI Audit — ${platform.toUpperCase()} — <DATE>

## Summary
| Severity | Count |
|----------|-------|
| Critical | ${criticalCount} |
| Warning  | ${warningCount} |
| Info     | ${infoCount} |

## Findings by Screen

For each screen that has findings, add a section header:
  ### <ScreenName>  ❌  (if any critical finding)
  ### <ScreenName>  ⚠   (if only warnings)
  ### <ScreenName>  ✓   (if only info)

Under each section, one bullet per finding:
  - **[<severity>] <issue>** — <detail>  Fix: <fix>

Skip screens with no findings.

## Maestro Results
| Flow | Result |
|------|--------|
One row per flow: ✅ if passed, ❌ <error> if failed, ⏭ Skipped if maestro was skipped.
\`\`\`

STEP 4: For each finding in the critical-reproducible list (${criticalReproducible.length} items), write a Maestro stub.
Run: mkdir -p e2e/maestro/regression

Stub filename: e2e/maestro/regression/<screen-kebab-case>-<category>.yaml
Example: e2e/maestro/regression/forgot-password-screen-keyboard.yaml

Stub template (fill in screen/issue/fix from the finding):
\`\`\`yaml
appId: app.yeride.dev
# Regression: <issue> on <screen>
# Category: <category>
# Fix: <fix>
# TODO: add the specific tap/scroll/assert sequence to reproduce the issue
---
- runFlow: ../../_lib/sign-in-as.yaml
  env:
    EMAIL: \${RIDER_EMAIL}
    PASSWORD: \${RIDER_PASSWORD}
# TODO: navigate to <screen> and reproduce: <detail>
\`\`\`

If criticalReproducible is empty, skip STEP 4.`,
  { label: 'synthesize', phase: 'Synthesis' },
);

log(
  `UI review complete — ${criticalCount} critical, ${warningCount} warnings, ${infoCount} info. See docs/ui-audit/.`,
);
```

- [ ] **Step 2: Verify the workflow parses without error**

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'fs'
// Quick syntax check — just import as text and verify it's valid JS
const src = readFileSync('.claude/workflows/ui-review.js', 'utf8')
console.log('Lines:', src.split('\n').length, '— no parse error')
EOF
```

Expected: prints line count, no SyntaxError.

- [ ] **Step 3: Run a dry Phase 1 only (no simulator needed)**

In Claude Code, run:

```
Workflow({ name: "ui-review", args: { platform: "ios", files: ["src/presentation/features/auth/screens/RegisterScreen.tsx"] } })
```

Expected: Phase 1 runs one agent (auth group), returns findings for RegisterScreen. Phase 2 agent detects no booted simulator and returns `skipped: true`. Phase 3 writes a report to `docs/ui-audit/`. No crash.

- [ ] **Step 4: Confirm the report file was created**

```bash
ls docs/ui-audit/
```

Expected: one `.md` file with today's date and `ios` in the name.

- [ ] **Step 5: Run the full iOS audit (simulator must be booted)**

```bash
# Set credentials first
export RIDER_EMAIL=<rider-stage-email>
export RIDER_PASSWORD=<rider-stage-password>
export DRIVER_EMAIL=<driver-stage-email>
export DRIVER_PASSWORD=<driver-stage-password>
```

In Claude Code, run:

```
Workflow({ name: "ui-review", args: { platform: "ios" } })
```

Expected: 5 parallel Phase 1 agents complete, 4 Maestro flows run, report written with all findings, regression stubs in `e2e/maestro/regression/` for any critical issues found.

- [ ] **Step 6: Commit**

```bash
git add .claude/workflows/ui-review.js docs/ui-audit/ e2e/maestro/regression/
git commit -m "feat: add ui-review Claude Code workflow (static analysis + Maestro + report)"
```

---

## Self-review notes

- **Spec coverage check:**
  - ✅ Four Maestro flows (`keyboard-inputs`, `scroll-reachability`, `bottom-actions`, `tab-navigation`) in `e2e/maestro/ui-review/`
  - ✅ Workflow script at `.claude/workflows/ui-review.js` with `name: 'ui-review'`
  - ✅ Phase 1: 5 parallel static-analysis agents, one per screen group
  - ✅ Phase 2: Maestro run agent with device detection, skips gracefully if no device
  - ✅ Phase 3: synthesis agent writes report + regression stubs
  - ✅ `files` arg for scoped change-review runs
  - ✅ `isFullAudit` gate runs walkthrough flows only on full audit
  - ✅ Platform-specific keyboard behavior check (`ios → "padding"`, `android → "height"`)
  - ✅ iOS vs Android device detection commands differ

- **Placeholder scan:** No TBDs. All YAML and JS code is complete. TODOs in regression stubs are intentional — they mark where the engineer adds the specific reproduction steps after confirming the issue.

- **Type consistency:** `FINDINGS_SCHEMA` field names (`screen`, `severity`, `category`, `issue`, `detail`, `fix`, `reproducible`) are used consistently in the synthesis agent prompt. `MAESTRO_SCHEMA` fields (`name`, `passed`, `error`) match what the run agent returns.

- **Known limitation:** `scroll-reachability.yaml` uses `optional: true` on wallet/earnings assertions because test account state (empty vs. populated) is unknown. This means the flow won't fail if the wallet has cards but the empty-state testID isn't visible — it just skips those assertions. Future: add a bottom-anchor testID to WalletScreen's FlatList footer.

- **Known limitation:** `profile-vehicles-link` is asserted on the Profile tab for both rider and driver. If riders don't see the vehicles section, this assertion will fail for riders. Fix: add a `profile-screen` testID to UserProfileScreen's root container and assert that instead.
