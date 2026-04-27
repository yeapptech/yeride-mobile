import { Email } from '@domain/entities/Email';
import type { AuthObserverState } from '@domain/repositories';

import { InMemoryAuthRepository } from '../InMemoryAuthRepository';

function makeEmail(value: string): Email {
  const r = Email.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('InMemoryAuthRepository.observeAuthState', () => {
  it('emits null on subscribe when no user is signed in', () => {
    const auth = new InMemoryAuthRepository();
    const calls: (AuthObserverState | null)[] = [];
    const unsubscribe = auth.observeAuthState((state) => {
      calls.push(state);
    });
    expect(calls).toEqual([null]);
    unsubscribe();
  });

  it('emits {userId, emailVerified:false} after signUp', async () => {
    const auth = new InMemoryAuthRepository();
    const calls: (AuthObserverState | null)[] = [];
    auth.observeAuthState((state) => {
      calls.push(state);
    });
    const r = await auth.signUp({
      email: makeEmail('ada@yeapp.tech'),
      password: 'hunter22',
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const last = calls[1];
    expect(last).not.toBeNull();
    if (last) {
      expect(last.emailVerified).toBe(false);
    }
  });

  it('re-emits with emailVerified:true when markCurrentVerified is called', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.signUp({
      email: makeEmail('ada@yeapp.tech'),
      password: 'hunter22',
    });
    const calls: (AuthObserverState | null)[] = [];
    auth.observeAuthState((state) => {
      calls.push(state);
    });
    // Synchronous emit on subscribe (still unverified)
    expect(calls).toHaveLength(1);
    expect(calls[0]?.emailVerified).toBe(false);

    auth.markCurrentVerified();

    // Should fire a second emission with emailVerified: true
    expect(calls).toHaveLength(2);
    expect(calls[1]?.emailVerified).toBe(true);
  });

  it('emits null on signOut and a fresh state on subsequent signIn', async () => {
    const auth = new InMemoryAuthRepository();
    auth.seedAccount({
      email: 'ada@yeapp.tech',
      password: 'hunter22',
      emailVerified: true,
    });
    const calls: (AuthObserverState | null)[] = [];
    auth.observeAuthState((state) => {
      calls.push(state);
    });
    expect(calls).toEqual([null]); // initial: not signed in
    await auth.signIn({
      email: makeEmail('ada@yeapp.tech'),
      password: 'hunter22',
    });
    expect(calls[1]?.emailVerified).toBe(true);
    await auth.signOut();
    expect(calls[2]).toBeNull();
  });
});
