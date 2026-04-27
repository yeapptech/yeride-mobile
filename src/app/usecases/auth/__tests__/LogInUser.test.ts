import { InMemoryAuthRepository } from '@shared/testing';

import { LogInUser } from '../LogInUser';

function setup() {
  const auth = new InMemoryAuthRepository();
  const sut = new LogInUser(auth);
  return { sut, auth };
}

describe('LogInUser', () => {
  it('signs an existing user in', async () => {
    const { sut, auth } = setup();
    auth.seedAccount({ email: 'ada@yeapp.tech', password: 'hunter22' });

    const r = await sut.execute({
      email: 'ada@yeapp.tech',
      password: 'hunter22',
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.value.userId).toBe('string');
      expect(await auth.currentUserId()).toBe(r.value.userId);
    }
  });

  it('rejects malformed email before any I/O', async () => {
    const { sut } = setup();
    const r = await sut.execute({ email: 'not-email', password: 'hunter22' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
  });

  it('surfaces unknown user as NotFoundError', async () => {
    const { sut } = setup();
    const r = await sut.execute({
      email: 'absent@yeapp.tech',
      password: 'hunter22',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not_found');
      expect(r.error.code).toBe('auth_user_not_found');
    }
  });

  it('surfaces wrong password as AuthorizationError', async () => {
    const { sut, auth } = setup();
    auth.seedAccount({ email: 'ada@yeapp.tech', password: 'hunter22' });
    const r = await sut.execute({
      email: 'ada@yeapp.tech',
      password: 'wrong',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_wrong_password');
    }
  });
});
