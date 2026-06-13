#!/usr/bin/env node
// PreToolUse hook: block edits/writes to secret-bearing files.
//   - .env / .env.development / .env.stage / .env.production (Stripe keys, BG-geo JWT, Maps keys)
//   - firebase/config/** (per-env Firebase config)
//   - google-services.json / GoogleService-Info.plist (native Firebase config w/ API keys)
// Reading these for context is fine; this only guards Write|Edit|MultiEdit.

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const fp = data.tool_input?.file_path ?? '';
if (!fp) process.exit(0);

const base = fp.split('/').pop() ?? '';

const isSecret =
  base === '.env' ||
  base.startsWith('.env.') ||
  fp.includes('/firebase/config/') ||
  base === 'google-services.json' ||
  base === 'GoogleService-Info.plist';

if (isSecret) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Refusing to edit secret-bearing file "${base}". It holds live credentials ` +
          '(Stripe / BG-geolocation JWT / Maps / Firebase config). Edit it by hand outside the agent, ' +
          'and never commit it. If you genuinely need to change it, do so manually.',
      },
    }),
  );
  process.exit(0);
}

process.exit(0);
