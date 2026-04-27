/**
 * The two roles a YeRide user can hold. A user picks their role at registration
 * and (for the rewrite) cannot switch later — riders and drivers are separate
 * accounts. Mirrors the legacy `user.role` Firestore field.
 */
export type Role = 'rider' | 'driver';

export const ALL_ROLES: readonly Role[] = ['rider', 'driver'] as const;

export function isRole(value: unknown): value is Role {
  return value === 'rider' || value === 'driver';
}
