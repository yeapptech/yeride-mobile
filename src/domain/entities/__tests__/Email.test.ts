import { Email } from '../Email';

describe('Email', () => {
  it('accepts a normal email', () => {
    const r = Email.create('hernando@yeapp.tech');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe('hernando@yeapp.tech');
  });

  it('normalizes to lowercase', () => {
    const r = Email.create('Hernando.Sierra@YeApp.Tech');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe('hernando.sierra@yeapp.tech');
  });

  it('trims surrounding whitespace', () => {
    const r = Email.create('   foo@bar.com   ');
    if (r.ok) expect(r.value.value).toBe('foo@bar.com');
  });

  it('accepts plus-addressing and subdomains', () => {
    expect(Email.create('foo+tag@bar.baz.com').ok).toBe(true);
  });

  it('rejects empty string', () => {
    const r = Email.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_empty');
  });

  it('rejects whitespace-only', () => {
    const r = Email.create('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_empty');
  });

  it('rejects missing @', () => {
    const r = Email.create('foobar.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
  });

  it('rejects missing TLD', () => {
    const r = Email.create('foo@bar');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
  });

  it('rejects single-character TLD', () => {
    const r = Email.create('foo@bar.c');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_invalid_format');
  });

  it('rejects spaces in the body', () => {
    const r = Email.create('foo bar@baz.com');
    expect(r.ok).toBe(false);
  });

  it('rejects emails over 254 characters', () => {
    const local = 'a'.repeat(250);
    const r = Email.create(`${local}@b.co`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_too_long');
  });

  it('rejects non-string input', () => {
    const r = Email.create(123 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('email_not_a_string');
  });

  it('compares by normalized value', () => {
    const a = Email.create('foo@bar.com');
    const b = Email.create('FOO@BAR.COM');
    if (a.ok && b.ok) expect(a.value.equals(b.value)).toBe(true);
  });
});
