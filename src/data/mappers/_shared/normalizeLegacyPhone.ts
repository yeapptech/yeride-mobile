/**
 * Tolerantly normalise a legacy phone string to E.164 before handing it
 * to the strict `PhoneNumber.create` factory.
 *
 * Legacy yeride's `UserProfile` zod regex is permissive (matches "(954)
 * 555-1234", "9545551234", "+19545551234", etc.), so historical user docs
 * frequently lack a leading "+" and country code. The rewrite domain
 * entity requires E.164. Tolerance lives at the mapper boundary — we
 * don't loosen the entity invariant for fresh writes.
 *
 * Strategy:
 *   - Pass-through any string that already starts with "+".
 *   - For digit-only input that's exactly 10 digits, prepend "+1"
 *     (NANP — US/Canada). Legacy yeride is US-only (Florida service
 *     area), so this is a safe heuristic.
 *   - For 11 digits starting with "1" (canonical NANP without the "+"),
 *     prepend "+".
 *   - Anything else passes through untouched — `PhoneNumber.create`
 *     surfaces the failure with its original error code so we don't
 *     silently misclassify e.g. a malformed international number.
 *
 * Used by `rideMapper.passengerToDomain` / `driverToDomain` (trip-doc
 * snapshot reads) and `userMapper.toDomain` (user-doc reads).
 */
export function normalizeLegacyPhone(raw: string): string {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return trimmed;
}
