/**
 * Branded types let us distinguish IDs and other primitive-typed values at the
 * type level. A `TripId` and a `UserId` are both strings at runtime, but the
 * compiler will reject one where the other is expected.
 *
 * Example:
 *   type TripId = Brand<string, 'TripId'>;
 *   type UserId = Brand<string, 'UserId'>;
 *
 *   function fetchTrip(id: TripId): Promise<Trip> { ... }
 *
 *   const userId: UserId = ...;
 *   fetchTrip(userId);  // ❌ compile error
 *
 * To create a branded value, use the `brand` helper at a trusted construction
 * site (typically a value-object factory or a mapper).
 */

declare const __brand: unique symbol;

export type Brand<T, K extends string> = T & { readonly [__brand]: K };

/**
 * Cast a primitive into its branded form. Only call this from a trusted
 * site that has *already* validated the value (e.g. inside a value-object
 * factory). Misuse defeats the whole point.
 *
 * Two type parameters are required so TypeScript doesn't have to infer the
 * underlying primitive through an intersection type — that inference path is
 * unreliable and triggers TS2345 in strict mode.
 *
 *   const id = brand<string, 'TripId'>('abc123');
 */
export function brand<T, K extends string>(value: T): Brand<T, K> {
  return value as Brand<T, K>;
}
