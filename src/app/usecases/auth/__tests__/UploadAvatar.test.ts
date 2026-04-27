import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { makeRider } from '@domain/entities/User';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { UploadAvatar } from '../UploadAvatar';

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
  users.seed(
    makeRider({
      id: uid,
      email: makeEmail('ada@yeapp.tech'),
      name: makeName(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }),
  );
  const sut = new UploadAvatar(auth, users, () => FIXED_NOW);
  return { sut, auth, users, uid };
}

describe('UploadAvatar', () => {
  it('uploads an avatar and writes the URL to the user', async () => {
    const { sut, users, uid } = await setupSignedIn();
    const r = await sut.execute({ imageUri: 'file:///tmp/avatar.jpg' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.user.avatarUrl).toMatch(/^https:\/\/avatars\.fake/);
    }
    const after = await users.getById(uid);
    if (after.ok) expect(after.value.avatarUrl).toMatch(/^https:\/\/avatars/);
  });

  it('rejects when image URI is empty', async () => {
    const { sut } = await setupSignedIn();
    const r = await sut.execute({ imageUri: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('avatar_invalid_image_uri');
  });

  it('returns AuthorizationError when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const users = new InMemoryUserRepository();
    const sut = new UploadAvatar(auth, users);
    const r = await sut.execute({ imageUri: 'file:///x.jpg' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('authorization');
  });
});
