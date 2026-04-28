/**
 * Lifecycle status of a registered vehicle.
 *
 *   - `pending`    — registered, awaiting admin review (legacy default for
 *                    older docs; rewrite auto-approves on `RegisterVehicle`)
 *   - `approved`   — eligible to be set active
 *   - `rejected`   — admin denied the registration; not eligible for active
 *   - `suspended`  — temporarily disabled (e.g. failed inspection)
 *   - `deleted`    — soft-deleted by the driver
 *
 * Note: `'deleted'` is included alongside the four legacy enum values
 * because the legacy `deleteVehicle` writes `status: 'deleted'` directly
 * (`yeride/src/api/firebase/Vehicle.js:218`). Modelling it as a domain
 * literal lets `Vehicle.markDeleted()` return a typed `Vehicle` and lets
 * read paths exclude soft-deleted docs at the type level instead of with
 * stringly-typed filters.
 */
export type VehicleStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'deleted';

export const VEHICLE_STATUSES: readonly VehicleStatus[] = [
  'pending',
  'approved',
  'rejected',
  'suspended',
  'deleted',
] as const;
