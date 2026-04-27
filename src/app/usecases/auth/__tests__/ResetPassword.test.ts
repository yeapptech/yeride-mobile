import { InMemoryAuthRepository } from '@shared/testing';

import { ResetPassword } from '../ResetPassword';

describe('ResetPassword', () => {
  it('triggers a password-reset email for a valid address', async () => {
    const auth = new InMemoryAuthRepository();
    const sut = new ResetPassword(auth);
    const r = await sut.execute({ email: 'ada@yeapp.tech' });
    expect(r.ok).toBe(true);
    expect(auth.spies.sendPasswordResetEmail).toBe(1);
  });

  it('also triggers for unknown addresses (Firebase does not enumerate)', async () => {
    const auth = new InMemoryAuthRepository();
    const sut = new ResetPassword(auth);
    const r = await sut.execute({ email: 'nobody@yeapp.tech' });
    expect(r.ok).toBe(true);
    expect(auth.spies.sendPasswordResetEmail).toBe(1);
  });

  it('rejects malformed email', async () => {
    const auth = new InMemoryAuthRepository();
    const sut = new ResetPassword(auth);
    const r = await sut.execute({ email: 'not-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
    expect(auth.spies.sendPasswordResetEmail).toBe(0);
  });
});
