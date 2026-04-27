import { PersonName } from '../PersonName';

describe('PersonName', () => {
  it('accepts a clean first/last pair', () => {
    const r = PersonName.create({ first: 'Hernando', last: 'Sierra' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.first).toBe('Hernando');
      expect(r.value.last).toBe('Sierra');
      expect(r.value.full).toBe('Hernando Sierra');
    }
  });

  it('preserves original capitalization for compound names', () => {
    const r = PersonName.create({ first: 'María', last: 'de la Cruz' });
    if (r.ok) expect(r.value.full).toBe('María de la Cruz');
  });

  it('trims surrounding whitespace', () => {
    const r = PersonName.create({ first: '  Ada  ', last: '  Lovelace  ' });
    if (r.ok) expect(r.value.full).toBe('Ada Lovelace');
  });

  it('rejects empty first name', () => {
    const r = PersonName.create({ first: '', last: 'Sierra' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('name_empty');
      expect(r.error.field).toBe('firstName');
    }
  });

  it('rejects whitespace-only last name', () => {
    const r = PersonName.create({ first: 'Hernando', last: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('lastName');
  });

  it('rejects names over 80 characters', () => {
    const r = PersonName.create({
      first: 'a'.repeat(81),
      last: 'Smith',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('name_too_long');
  });

  it('rejects non-string input', () => {
    const r = PersonName.create({
      first: 1 as unknown as string,
      last: 'Smith',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('name_not_a_string');
  });

  it('compares by value', () => {
    const a = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    const b = PersonName.create({ first: 'Ada', last: 'Lovelace' });
    const c = PersonName.create({ first: 'Ada', last: 'Byron' });
    if (a.ok && b.ok && c.ok) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.equals(c.value)).toBe(false);
    }
  });
});
