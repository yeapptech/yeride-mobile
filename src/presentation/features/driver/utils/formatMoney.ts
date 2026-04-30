/**
 * Deprecation shim — `formatMoney` moved to `@presentation/utils/formatMoney`
 * in Phase 6 turn 5 so both rider-side and driver-side surfaces can
 * share it. Existing imports keep working through this re-export.
 *
 * Remove this file (and update any stragglers to import from
 * `@presentation/utils/formatMoney`) in any non-sandbox checkout. The
 * sandbox virtiofs blocks `unlink()` so we can't delete it from this
 * environment.
 */
export { formatMoney } from '@presentation/utils/formatMoney';
