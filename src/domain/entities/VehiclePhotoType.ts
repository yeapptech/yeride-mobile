/**
 * The five photo perspectives required for a complete vehicle registration.
 * Matches legacy `uploadVehiclePhoto` validation set (front/back/left/right/
 * interior) and the storage path layout `vehicles/{vin}/{type}_{ts}.jpg`.
 *
 * One slot per type. Re-uploading overwrites the previous URL on the
 * vehicle doc; the underlying Storage object is left in place (legacy
 * behavior — historical photos are not actively pruned).
 */
export type VehiclePhotoType = 'front' | 'back' | 'left' | 'right' | 'interior';

export const VEHICLE_PHOTO_TYPES: readonly VehiclePhotoType[] = [
  'front',
  'back',
  'left',
  'right',
  'interior',
] as const;

export function isVehiclePhotoType(value: unknown): value is VehiclePhotoType {
  return (
    typeof value === 'string' &&
    (VEHICLE_PHOTO_TYPES as readonly string[]).includes(value)
  );
}
