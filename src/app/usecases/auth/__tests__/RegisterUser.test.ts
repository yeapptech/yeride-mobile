import { isRider } from '@domain/entities/User';
import {
  InMemoryAuthRepository,
  InMemoryUserRepository,
} from '@shared/testing';

import { RegisterUser } from '../RegisterUser';

const FIXED_NOW = new Date('2026-04-27T00:00:00Z');

function setup() {
  const auth = new InMemoryAuthRepository();
  const users = new InMemoryUserRepository();
  const sut = new RegisterUser(auth, users, () => FIXED_NOW);
  return { sut, auth, users };
}

describe('RegisterUser', () => {
  const validInput = {
    email: 'ada@yeapp.tech',
    password: 'hunter22',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+14155550123',
    role: 'rider' as const,
  };

  it('registers a Rider end-to-end', async () => {
    const { sut, auth, users } = setup();

    const r = await sut.execute(validInput);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isRider(r.value.user)).toBe(true);
      expect(r.value.user.email.value).toBe('ada@yeapp.tech');
      expect(r.value.user.name.full).toBe('Ada Lovelace');
      expect(r.value.user.phone?.value).toBe('+14155550123');
      expect(r.value.user.createdAt).toBe(FIXED_NOW);
      expect(r.value.user.emailVerified).toBe(false);
    }
    expect(users.size()).toBe(1);
    expect(auth.spies.sendEmailVerification).toBe(1);
  });

  it('registers a Driver branch', async () => {
    const { sut } = setup();
    const r = await sut.execute({ ...validInput, role: 'driver' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.user.role).toBe('driver');
  });

  it('registers without a phone number', async () => {
    const { sut } = setup();
    const r = await sut.execute({ ...validInput, phone: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.user.phone).toBeNull();
  });

  it('rejects malformed email before any I/O', async () => {
    const { sut, auth, users } = setup();
    const r = await sut.execute({ ...validInput, email: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
    // Should not have hit auth or users
    expect(users.size()).toBe(0);
    expect(auth.spies.sendEmailVerification).toBe(0);
  });

  it('rejects empty first name', async () => {
    const { sut } = setup();
    const r = await sut.execute({ ...validInput, firstName: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('name_empty');
  });

  it('rejects malformed phone', async () => {
    const { sut } = setup();
    const r = await sut.execute({ ...validInput, phone: '12345' });
    expect(r.ok).toBe(false);
  });

  it('surfaces password-too-short from the auth subsystem', async () => {
    const { sut } = setup();
    const r = await sut.execute({ ...validInput, password: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth_weak_password');
  });

  it('surfaces email-already-in-use as ConflictError', async () => {
    const { sut } = setup();
    await sut.execute(validInput);
    const r2 = await sut.execute(validInput);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.kind).toBe('conflict');
      expect(r2.error.code).toBe('auth_email_already_in_use');
    }
  });
});
