import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { makeRider } from '@domain/entities/User';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { CheckEmailVerified } from '../CheckEmailVerified';

const FIXED_NOW = new Date('2026-04-27T00:00:00Z');

function makeEmail(value: string): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function makeName(): PersonName {
  const r = PersonName.create({ first: 'Ada', last: 'Lovelace' });
  if (!r.ok) throw r.error;
  return r.value;
}

async function setupSignedIn() {
  const auth = new InMemoryAuthRepository();
  const users = new InMemoryUserRepository();
  auth.seedAccount({
    email: 'ada@yeapp.tech',
    password: 'hunter22',
  });
  await auth.signIn({
    email: makeEmail('ada@yeapp.tech'),
    password: 'hunter22',
  });
  const uid = (await auth.currentUserId())!;
  const user = makeRider({
    id: uid,
    email: makeEmail('ada@yeapp.tech'),
    name: makeName(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
  users.seed(user);
  const sut = new CheckEmailVerified(auth, users, () => FIXED_NOW);
  return { sut, auth, users, uid };
}

describe('CheckEmailVerified', () => {
  it('reports not-verified without touching the user doc', async () => {
    const { sut, users } = await setupSignedIn();
    const r = await sut.execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.verified).toBe(false);
    expect(users.spies.update).toBe(0);
  });

  it('flips emailVerified on the user doc on transition false→true', async () => {
    const { sut, auth, users, uid } = await setupSignedIn();
    auth.markCurrentVerified();

    const r = await sut.execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.verified).toBe(true);
    expect(users.spies.update).toBe(1);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.emailVerified).toBe(true);
  });

  it('does not double-write when the doc already says verified', async () => {
    const { sut, auth, users, uid } = await setupSignedIn();
    auth.markCurrentVerified();
    // First run flips the flag.
    await sut.execute();
    const before = users.spies.update;
    // Second run: nothing to update.
    await sut.execute();
    expect(users.spies.update).toBe(before);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.emailVerified).toBe(true);
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const users = new InMemoryUserRepository();
    const sut = new CheckEmailVerified(auth, users);
    const r = await sut.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('authorization');
  });
});
