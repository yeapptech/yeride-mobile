import { Email } from '@domain/entities/Email';
import { InMemoryAuthRepository } from '@shared/testing';

import { LogOutUser } from '../LogOutUser';

function makeEmail(value: string): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('LogOutUser', () => {
  it('signs the current user out', async () => {
    const auth = new InMemoryAuthRepository();
    auth.seedAccount({ email: 'ada@yeapp.tech', password: 'hunter22' });
    await auth.signIn({
      email: makeEmail('ada@yeapp.tech'),
      password: 'hunter22',
    });
    expect(await auth.currentUserId()).not.toBeNull();

    const sut = new LogOutUser(auth);
    const r = await sut.execute();

    expect(r.ok).toBe(true);
    expect(await auth.currentUserId()).toBeNull();
  });

  it('is idempotent when no user is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const sut = new LogOutUser(auth);
    const r = await sut.execute();
    expect(r.ok).toBe(true);
  });
});
