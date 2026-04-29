/**
 * Shared fixture builders for payment use case tests. Keeps the per-test
 * setup terse so the assertions stay legible.
 */
import { Email } from '@domain/entities/Email';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import {
  type Driver,
  type Rider,
  makeDriver,
  makeRider,
} from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

export function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: Error },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

export const FIXED_NOW = new Date('2026-04-29T00:00:00Z');

export function uid(seed = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa'): UserId {
  return unwrap(UserId.create(seed));
}

export function email(value = 'rider@yeapp.tech'): Email {
  return unwrap(Email.create(value));
}

export function personName(): PersonName {
  return unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' }));
}

export function phone(): PhoneNumber {
  return unwrap(PhoneNumber.create('+14155550123'));
}

export function cusId(value = 'cus_test123'): StripeCustomerId {
  return unwrap(StripeCustomerId.create(value));
}

export function acctId(value = 'acct_test123'): StripeAccountId {
  return unwrap(StripeAccountId.create(value));
}

export function pmId(value = 'pm_test123'): PaymentMethodId {
  return unwrap(PaymentMethodId.create(value));
}

export function makeRiderUser(
  overrides: Partial<Parameters<typeof makeRider>[0]> = {},
): Rider {
  return makeRider({
    id: uid(),
    email: email(),
    name: personName(),
    phone: phone(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  });
}

export function makeDriverUser(
  overrides: Partial<Parameters<typeof makeDriver>[0]> = {},
): Driver {
  return makeDriver({
    id: uid(),
    email: email('driver@yeapp.tech'),
    name: personName(),
    phone: phone(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  });
}

export async function setupSignedInRider(
  riderOverrides: Partial<Parameters<typeof makeRider>[0]> = {},
): Promise<{
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  rider: Rider;
}> {
  const authRepo = new InMemoryAuthRepository();
  const signUpR = await authRepo.signUp({
    email: email(),
    password: 'pw1234',
  });
  const userId = unwrap(signUpR);

  const usersRepo = new InMemoryUserRepository();
  const rider = makeRider({
    id: userId,
    email: email(),
    name: personName(),
    phone: phone(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...riderOverrides,
  });
  await usersRepo.create(rider);
  return { authRepo, usersRepo, rider };
}

export async function setupSignedInDriver(
  driverOverrides: Partial<Parameters<typeof makeDriver>[0]> = {},
): Promise<{
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  driver: Driver;
}> {
  const authRepo = new InMemoryAuthRepository();
  const signUpR = await authRepo.signUp({
    email: email('driver@yeapp.tech'),
    password: 'pw1234',
  });
  const userId = unwrap(signUpR);

  const usersRepo = new InMemoryUserRepository();
  const driver = makeDriver({
    id: userId,
    email: email('driver@yeapp.tech'),
    name: personName(),
    phone: phone(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...driverOverrides,
  });
  await usersRepo.create(driver);
  return { authRepo, usersRepo, driver };
}
