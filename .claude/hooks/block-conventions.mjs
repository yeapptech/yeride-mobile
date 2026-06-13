#!/usr/bin/env node
// PreToolUse hook: enforce two hard YeRide-Next conventions BEFORE an edit lands,
// instead of waiting for the next `npm run lint`.
//   1. No `console.*` inside src/ (use LOG from @shared/logger). Logger + tests exempt.
//   2. presentation/ must not import from the data layer (@data/...). container.ts exempt.
// Both are also caught by eslint-plugin-boundaries / the logger rule — this is just
// instant feedback. Emits a PreToolUse "deny" decision on violation; silent otherwise.

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0); // malformed payload: don't block
}

const ti = data.tool_input ?? {};
const fp = ti.file_path ?? '';

// Only the source tree is governed by these rules.
if (!fp.includes('/src/')) process.exit(0);

// Gather only the text being ADDED (Write content / Edit + MultiEdit new_string).
let added = '';
if (typeof ti.content === 'string') added += ti.content + '\n';
if (typeof ti.new_string === 'string') added += ti.new_string + '\n';
if (Array.isArray(ti.edits)) {
  for (const e of ti.edits) {
    if (e && typeof e.new_string === 'string') added += e.new_string + '\n';
  }
}
if (!added) process.exit(0);

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

const isLogger = fp.includes('/src/shared/logger/');
const isTest =
  /\.(test|spec)\.[jt]sx?$/.test(fp) ||
  fp.includes('/__tests__/') ||
  fp.includes('jest.setup');

// Rule 1 — console.* outside the logger (tests may spy on console, so exempt them).
if (
  !isLogger &&
  !isTest &&
  /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(added)
) {
  deny(
    "YeRide-Next rule: never console.* outside @shared/logger. Use `LOG.extend('Module')` " +
      'and the right level (LOG.error fans out to Crashlytics; LOG.warn does not). See CLAUDE.md §Logging.',
  );
}

// Rule 2 — presentation importing the data layer. container.ts is the lone allowed seam.
const isPresentation = fp.includes('/src/presentation/');
const isContainer = fp.endsWith('/di/container.ts');
const importsData =
  /\bfrom\s+['"]@data(\/|['"])/.test(added) ||
  /\brequire\(\s*['"]@data\//.test(added) ||
  /\bfrom\s+['"][^'"]*\/src\/data\//.test(added);

if (isPresentation && !isContainer && importsData) {
  deny(
    'YeRide-Next layer rule: presentation cannot import from @data. Depend on a @domain interface ' +
      '(SDK seams live in @domain/services) and let the DI container wire the adapter. ' +
      'Only src/presentation/di/container.ts may require @data (it is the composition root).',
  );
}

process.exit(0);
