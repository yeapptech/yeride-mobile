import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { makeRider } from '@domain/entities/User';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { UpdateProfile } from '../UpdateProfile';

const INITIAL = new Date('2026-04-27T00:00:00Z');
const LATER = new Date('2026-04-28T00:00:00Z');

function makeEmail(value: string): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function makeName(first = 'Ada', last = 'Lovelace'): PersonName {
  const r = PersonName.create({ first, last });
  if (!r.ok) throw r.error;
  return r.value;
}

function makePhone(value = '+14155550123'): PhoneNumber {
  const r = PhoneNumber.create(value);
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
    phone: makePhone(),
    createdAt: INITIAL,
    updatedAt: INITIAL,
  });
  users.seed(user);
  const sut = new UpdateProfile(auth, users, () => LATER);
  return { sut, auth, users, uid };
}

describe('UpdateProfile', () => {
  it('updates first and last name', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) {
      expect(after.value.name.full).toBe('Grace Hopper');
      expect(after.value.updatedAt).toBe(LATER);
    }
  });

  it('updates only first name (last untouched)', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({ firstName: 'Augusta' });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.name.full).toBe('Augusta Lovelace');
  });

  it('updates phone', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({ phone: '+14155550456' });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.phone?.value).toBe('+14155550456');
  });

  it('clears phone with explicit null', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({ phone: null });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.phone).toBeNull();
  });

  it('clears phone with empty string', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({ phone: '' });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.phone).toBeNull();
  });

  it('leaves phone untouched when omitted', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({ firstName: 'Augusta' });
    expect(r.ok).toBe(true);
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.phone?.value).toBe('+14155550123');
  });

  it('rejects malformed phone', async () => {
    const { sut } = await setupSignedIn();
    const r = await sut.execute({ phone: '12345' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty first name', async () => {
    const { sut } = await setupSignedIn();
    const r = await sut.execute({ firstName: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('name_empty');
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const users = new InMemoryUserRepository();
    const sut = new UpdateProfile(auth, users);
    const r = await sut.execute({ firstName: 'Grace' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('authorization');
  });
});
