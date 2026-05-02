import { Address } from '@domain/entities/Address';
import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { PushToken } from '@domain/entities/PushToken';
import { SavedPlace, SavedPlaceId } from '@domain/entities/SavedPlace';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { type User, makeDriver, makeRider } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import { UserDocSchema, type UserDoc } from '../dto/UserDoc';

const logger = LOG.extend('userMapper');

/**
 * Bidirectional mappers between the Firestore `users/{uid}` document and the
 * domain `User` entity.
 *
 * `toDomain` is total — given a parsed UserDoc, it always succeeds (the doc
 * shape was already validated by zod at parse time, and value-object
 * factories below cannot fail on already-validated input).
 *
 * `parse` runs zod against an unknown blob (fresh from Firestore), wrapping
 * any schema failure in a ValidationError.
 *
 * `toDoc` produces a Firestore-write-shape plain object. It writes the new
 * canonical field names (`phoneNumber` over `phone`, `updatedDateTime`) but
 * stays compatible with what the legacy app reads.
 */

/* ─────────────────────────── Parse (raw → DTO) ───────────────── */

/**
 * Parse an unknown Firestore document blob into a UserDoc, surfacing schema
 * failures as ValidationError. Use when you've fetched a doc and need a
 * trustworthy shape before calling `toDomain`.
 */
export function parseUserDoc(raw: unknown): Result<UserDoc, ValidationError> {
  const r = UserDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'user_doc_schema_invalid',
        message: 'Firestore user doc did not match expected shape',
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

/* ─────────────────────────── Domain → DTO ──────────────────────── */

export function toDoc(user: User): UserDoc {
  const phoneStr = user.phone?.value ?? null;
  const base = {
    email: user.email.value,
    firstName: user.name.first,
    lastName: user.name.last,
    phoneNumber: phoneStr,
    emailVerified: user.emailVerified,
    avatar: user.avatarUrl,
    savedPlaces: user.savedPlaces.map((p) => ({
      place_id: String(p.id),
      label: p.label,
      address: p.address.label,
      latitude: p.address.coordinates.latitude,
      longitude: p.address.coordinates.longitude,
    })),
    createdDateTime: user.createdAt.toISOString(),
    updatedDateTime: user.updatedAt.toISOString(),
    // Phase 9 turn 2: branded `PushToken` strips cleanly via `String(...)`;
    // `null` stays null so the field doesn't get persisted as the string
    // "null" (matches the legacy `users/{uid}.pushToken` shape — see
    // `yeride/src/api/firebase/AuthUser.js:savePushToken`).
    pushToken: user.pushToken !== null ? String(user.pushToken) : null,
  };

  if (user.role === 'rider') {
    return {
      ...base,
      role: 'rider' as const,
      // Branded ids stringify cleanly via `String(...)`; null stays null
      // (so the field is dropped on writes rather than written as the
      // string "null").
      stripeCustomerId:
        user.stripeCustomerId !== null ? String(user.stripeCustomerId) : null,
      defaultPaymentMethodId:
        user.defaultPaymentMethodId !== null
          ? String(user.defaultPaymentMethodId)
          : null,
    };
  }
  // Drivers get BOTH the flat (canonical) and legacy-nested Stripe shapes.
  // The legacy yeride app reads `user.stripe.id` (see
  // `src/driver/screens/Earnings.js`), so we keep writing the nested shape
  // under `setDoc { merge: true }` to stay backward-compatible. Writing the
  // flat fields too means the rewrite's reads stay fast (no nested
  // traversal) and a future cleanup migration can drop the nested shape
  // without coordinated client updates.
  const flatAccountId =
    user.stripeAccountId !== null ? String(user.stripeAccountId) : null;
  const nestedStripe =
    flatAccountId !== null
      ? {
          id: flatAccountId,
          charges_enabled: user.stripeChargesEnabled,
          payouts_enabled: user.stripePayoutsEnabled,
        }
      : null;
  return {
    ...base,
    role: 'driver' as const,
    stripeAccountId: flatAccountId,
    stripeChargesEnabled: user.stripeChargesEnabled,
    stripePayoutsEnabled: user.stripePayoutsEnabled,
    stripe: nestedStripe,
    activeVehicleId: user.activeVehicleId,
    vehicleIds: [...user.vehicleIds],
  };
}

/* ─────────────────────────── DTO → Domain ──────────────────────── */

/**
 * Construct a domain `User` from a (validated) Firestore user doc plus the
 * doc id (the Firebase Auth uid).
 *
 * Returns ValidationError if any value-object factory rejects — this would
 * indicate the doc shape passed zod parse but contained semantic invalidity
 * (e.g. lat/lng out of range despite zod's range checks — defense in
 * depth).
 */
export function toDomain(
  uid: UserId,
  doc: UserDoc,
): Result<User, ValidationError> {
  const emailR = Email.create(doc.email);
  if (!emailR.ok) return emailR;

  const nameR = PersonName.create({
    first: doc.firstName,
    last: doc.lastName,
  });
  if (!nameR.ok) return nameR;

  // Accept either field name; prefer the new canonical `phoneNumber`.
  const rawPhone = doc.phoneNumber ?? doc.phone ?? null;
  let phone: PhoneNumber | null = null;
  if (rawPhone !== null && rawPhone !== '') {
    const phoneR = PhoneNumber.create(rawPhone);
    if (!phoneR.ok) return phoneR;
    phone = phoneR.value;
  }

  const placesR = mapSavedPlaces(doc.savedPlaces);
  if (!placesR.ok) return placesR;

  const createdAt = parseIsoDate(doc.createdDateTime, 'createdDateTime');
  if (!createdAt.ok) return createdAt;
  const updatedAt =
    doc.updatedDateTime !== null && doc.updatedDateTime !== undefined
      ? parseIsoDate(doc.updatedDateTime, 'updatedDateTime')
      : Result.ok(createdAt.value);
  if (!updatedAt.ok) return updatedAt;

  const common = {
    id: uid,
    email: emailR.value,
    emailVerified: doc.emailVerified,
    name: nameR.value,
    phone,
    avatarUrl: doc.avatar ?? null,
    savedPlaces: placesR.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    pushToken: parsePushToken(doc.pushToken, uid),
  };

  if (doc.role === 'rider') {
    return Result.ok(
      makeRider({
        ...common,
        stripeCustomerId: parseStripeCustomerId(doc.stripeCustomerId, uid),
        defaultPaymentMethodId: parsePaymentMethodId(
          doc.defaultPaymentMethodId,
          uid,
        ),
      }),
    );
  }

  // Stripe Connect: prefer the rewrite's flat fields; fall back to the
  // legacy nested `stripe` object if the flat fields aren't present.
  // Either source can be missing — both round-trip through `null` /
  // `false` defaults.
  const flatAccountId = doc.stripeAccountId ?? null;
  const nested = doc.stripe ?? null;
  const rawAccountId = flatAccountId ?? nested?.id ?? null;
  const stripeChargesEnabled =
    doc.stripeChargesEnabled ?? nested?.charges_enabled ?? false;
  const stripePayoutsEnabled =
    doc.stripePayoutsEnabled ?? nested?.payouts_enabled ?? false;

  return Result.ok(
    makeDriver({
      ...common,
      stripeAccountId: parseStripeAccountId(rawAccountId, uid),
      stripeChargesEnabled,
      stripePayoutsEnabled,
      activeVehicleId: doc.activeVehicleId ?? null,
      vehicleIds: doc.vehicleIds,
    }),
  );
}

/**
 * Validate a raw `cus_*` string into a `StripeCustomerId`. Falls back to
 * `null` (with a `LOG.warn`) on shape failure rather than crashing the
 * whole user hydration — a malformed Stripe id on a single user doc
 * shouldn't take down the app's auth flow.
 */
function parseStripeCustomerId(
  raw: string | null | undefined,
  uid: UserId,
): StripeCustomerId | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const r = StripeCustomerId.create(raw);
  if (!r.ok) {
    logger.warn('toDomain: malformed stripeCustomerId; treating as null', {
      uid: String(uid),
      code: r.error.code,
    });
    return null;
  }
  return r.value;
}

function parseStripeAccountId(
  raw: string | null | undefined,
  uid: UserId,
): StripeAccountId | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const r = StripeAccountId.create(raw);
  if (!r.ok) {
    logger.warn('toDomain: malformed stripeAccountId; treating as null', {
      uid: String(uid),
      code: r.error.code,
    });
    return null;
  }
  return r.value;
}

function parsePaymentMethodId(
  raw: string | null | undefined,
  uid: UserId,
): PaymentMethodId | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const r = PaymentMethodId.create(raw);
  if (!r.ok) {
    logger.warn(
      'toDomain: malformed defaultPaymentMethodId; treating as null',
      {
        uid: String(uid),
        code: r.error.code,
      },
    );
    return null;
  }
  return r.value;
}

/**
 * Validate a raw push-token string into a `PushToken`. Falls back to `null`
 * (with a `LOG.warn`) on shape failure rather than crashing the whole user
 * hydration — a malformed token on a single user doc shouldn't take down
 * the app's auth flow. The `RegisterPushToken` use case (Phase 9 turn 2)
 * will overwrite the bad value on next launch.
 */
function parsePushToken(
  raw: string | null | undefined,
  uid: UserId,
): PushToken | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const r = PushToken.create(raw);
  if (!r.ok) {
    logger.warn('toDomain: malformed pushToken; treating as null', {
      uid: String(uid),
      code: r.error.code,
    });
    return null;
  }
  return r.value;
}

/* ─────────────────────────── helpers ──────────────────────────── */

function mapSavedPlaces(
  raw: UserDoc['savedPlaces'],
): Result<readonly SavedPlace[], ValidationError> {
  const out: SavedPlace[] = [];
  for (const p of raw) {
    const idR = SavedPlaceId.create(p.place_id);
    if (!idR.ok) return idR;
    const coordsR = Coordinates.create(p.latitude, p.longitude);
    if (!coordsR.ok) return coordsR;
    const addressR = Address.create({
      label: p.address,
      coordinates: coordsR.value,
    });
    if (!addressR.ok) return addressR;
    const placeR = SavedPlace.create({
      id: idR.value,
      label: p.label,
      address: addressR.value,
    });
    if (!placeR.ok) return placeR;
    out.push(placeR.value);
  }
  return Result.ok(out);
}

function parseIsoDate(
  iso: string,
  field: string,
): Result<Date, ValidationError> {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return Result.err(
      new ValidationError({
        code: 'user_doc_invalid_date',
        message: `${field} is not a valid ISO date string`,
        field,
      }),
    );
  }
  return Result.ok(new Date(ms));
}
