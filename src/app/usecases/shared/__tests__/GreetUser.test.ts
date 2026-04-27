import { GreetUser } from '../GreetUser';

describe('GreetUser', () => {
  const sut = new GreetUser();

  it('greets a normal name', () => {
    const r = sut.execute({ name: 'Hernando' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.greeting).toBe('Hello, Hernando!');
  });

  it('trims whitespace', () => {
    const r = sut.execute({ name: '  Ada  ' });
    if (r.ok) expect(r.value.greeting).toBe('Hello, Ada!');
  });

  it('rejects an empty name', () => {
    const r = sut.execute({ name: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('greet_empty_name');
      expect(r.error.field).toBe('name');
    }
  });

  it('rejects whitespace-only', () => {
    const r = sut.execute({ name: '   ' });
    expect(r.ok).toBe(false);
  });
});
