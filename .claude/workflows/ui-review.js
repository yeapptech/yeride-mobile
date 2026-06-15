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

Group: ${g.group}
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

const deviceCheckCmd =
  platform === 'ios'
    ? 'xcrun simctl list devices booted 2>/dev/null | grep Booted'
    : 'adb devices 2>/dev/null | grep -v "List of" | grep -v "^$"';

const deviceIdCmd =
  platform === 'ios'
    ? "xcrun simctl list devices booted 2>/dev/null | grep Booted | head -1 | grep -o '[A-F0-9-]\\{36\\}'"
    : "adb devices 2>/dev/null | grep -v 'List of' | grep -v '^$' | head -1 | awk '{print $1}'";

const maestroResults = await agent(
  `Run Maestro UI flows and return structured results.

STEP 1 — Check for a connected ${platform === 'ios' ? 'iOS simulator' : 'Android emulator'}:
Run: ${deviceCheckCmd}
If output is empty, return { skipped: true, flows: [], skipReason: "No ${platform === 'ios' ? 'booted iOS simulator' : 'connected Android emulator'} found — boot one and re-run" }.

STEP 2 — Check Maestro CLI:
Run: ls ~/.maestro/bin/maestro 2>/dev/null || echo MISSING
If output is "MISSING", return { skipped: true, flows: [], skipReason: "Maestro CLI not found at ~/.maestro/bin/maestro" }.

STEP 3 — Get the device ID to target explicitly (prevents Maestro defaulting to a connected Android when iOS is requested):
Run: ${deviceIdCmd}
Save the output as DEVICE_ID. If empty, skip --device flag.

STEP 4 — Run each flow in sequence:
export PATH="$PATH:$HOME/.maestro/bin"

${allFlows.map((f) => `maestro --device $DEVICE_ID test --env RIDER_EMAIL=$RIDER_EMAIL --env RIDER_PASSWORD=$RIDER_PASSWORD --env DRIVER_EMAIL=$DRIVER_EMAIL --env DRIVER_PASSWORD=$DRIVER_PASSWORD ${f}`).join('\n')}

Credentials (RIDER_EMAIL, RIDER_PASSWORD, DRIVER_EMAIL, DRIVER_PASSWORD) must already be set in the calling environment.

STEP 5 — For each flow, record:
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

const maestroSummary = !maestroResults
  ? 'ERROR: Maestro agent returned no result'
  : maestroResults.skipped
    ? 'SKIPPED: ' + (maestroResults.skipReason ?? 'unknown reason')
    : JSON.stringify(maestroResults.flows ?? [], null, 2);

await agent(
  `Write a UI audit report and Maestro regression stubs.

Platform: ${platform}
Findings (${allFindings.length} total — ${criticalCount} critical, ${warningCount} warning, ${infoCount} info):
${JSON.stringify(allFindings, null, 2)}

Maestro results:
${maestroSummary}

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
- runFlow: ../_lib/sign-in-as.yaml
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
