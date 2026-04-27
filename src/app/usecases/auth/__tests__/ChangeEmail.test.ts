import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { setEmailVerified, makeRider } from '@domain/entities/User';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { ChangeEmail } from '../ChangeEmail';

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
  const baseUser = makeRider({
    id: uid,
    email: makeEmail('ada@yeapp.tech'),
    name: makeName(),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
  const user = setEmailVerified(baseUser, true, FIXED_NOW);
  users.seed(user);
  const sut = new ChangeEmail(auth, users, () => FIXED_NOW);
  return { sut, auth, users, uid };
}

describe('ChangeEmail', () => {
  it('changes the email and clears verification', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({
      newEmail: 'lovelace@yeapp.tech',
      currentPassword: 'hunter22',
    });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) {
      expect(after.value.email.value).toBe('lovelace@yeapp.tech');
      expect(after.value.emailVerified).toBe(false);
    }
  });

  it('rejects malformed new email', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({
      newEmail: 'not-email',
      currentPassword: 'hunter22',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
    // user doc unchanged
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.email.value).toBe('ada@yeapp.tech');
  });

  it('rejects on wrong current password', async () => {
    const { sut } = await setupSignedIn();
    const r = await sut.execute({
      newEmail: 'lovelace@yeapp.tech',
      currentPassword: 'wrong',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_wrong_password');
    }
  });

  it('rejects when new email is already in use', async () => {
    const { sut, auth } = await setupSignedIn();
    auth.seedAccount({
      email: 'taken@yeapp.tech',
      password: 'whatever',
    });
    const r = await sut.execute({
      newEmail: 'taken@yeapp.tech',
      currentPassword: 'hunter22',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('conflict');
      expect(r.error.code).toBe('auth_email_already_in_use');
    }
  });
});
