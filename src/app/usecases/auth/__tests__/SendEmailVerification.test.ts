import { Email } from '@domain/entities/Email';
import { InMemoryAuthRepository } from '@shared/testing';

import { SendEmailVerification } from '../SendEmailVerification';

function makeEmail(value: string): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('SendEmailVerification', () => {
  it('triggers a verification email when signed in', async () => {
    const auth = new InMemoryAuthRepository();
    auth.seedAccount({ email: 'ada@yeapp.tech', password: 'hunter22' });
    await auth.signIn({
      email: makeEmail('ada@yeapp.tech'),
      password: 'hunter22',
    });

    const sut = new SendEmailVerification(auth);
    const r = await sut.execute();

    expect(r.ok).toBe(true);
    expect(auth.spies.sendEmailVerification).toBe(1);
  });

  it('returns AuthorizationError when no one is signed in', async () => {
    const auth = new InMemoryAuthRepository();
    const sut = new SendEmailVerification(auth);
    const r = await sut.execute();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('auth_no_current_user');
    }
  });
});
