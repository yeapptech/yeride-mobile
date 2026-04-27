import { Address } from '../Address';
import { Coordinates } from '../Coordinates';
import { SavedPlace, SavedPlaceId } from '../SavedPlace';

function makeAddress(): Address {
  const coords = Coordinates.create(37.4275, -122.1697);
  if (!coords.ok) throw coords.error;
  const a = Address.create({ label: '1 Main St', coordinates: coords.value });
  if (!a.ok) throw a.error;
  return a.value;
}

function makeId(value = 'place-home-1'): SavedPlaceId {
  const r = SavedPlaceId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('SavedPlaceId', () => {
  it('accepts a non-empty string', () => {
    const r = SavedPlaceId.create('home');
    expect(r.ok).toBe(true);
  });

  it('trims whitespace', () => {
    const r = SavedPlaceId.create('  abc  ');
    if (r.ok) expect(r.value).toBe('abc');
  });

  it('rejects empty', () => {
    const r = SavedPlaceId.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('saved_place_id_empty');
  });

  it('rejects very long ids', () => {
    const r = SavedPlaceId.create('x'.repeat(201));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('saved_place_id_too_long');
  });

  it('rejects non-string', () => {
    const r = SavedPlaceId.create(123 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('saved_place_id_not_a_string');
  });
});

describe('SavedPlace', () => {
  it('builds a valid place', () => {
    const r = SavedPlace.create({
      id: makeId(),
      label: 'Home',
      address: makeAddress(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.label).toBe('Home');
      expect(r.value.address.label).toBe('1 Main St');
    }
  });

  it('trims label whitespace', () => {
    const r = SavedPlace.create({
      id: makeId(),
      label: '  Work  ',
      address: makeAddress(),
    });
    if (r.ok) expect(r.value.label).toBe('Work');
  });

  it('rejects empty label', () => {
    const r = SavedPlace.create({
      id: makeId(),
      label: '   ',
      address: makeAddress(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('saved_place_label_empty');
  });

  it('rejects label over 60 characters', () => {
    const r = SavedPlace.create({
      id: makeId(),
      label: 'x'.repeat(61),
      address: makeAddress(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('saved_place_label_too_long');
  });

  it('rejects non-string label', () => {
    const r = SavedPlace.create({
      id: makeId(),
      label: 1 as unknown as string,
      address: makeAddress(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('saved_place_label_not_a_string');
  });

  describe('withLabel', () => {
    it('returns a new instance with updated label', () => {
      const place = SavedPlace.create({
        id: makeId(),
        label: 'Home',
        address: makeAddress(),
      });
      if (!place.ok) throw place.error;
      const r = place.value.withLabel('My Place');
      if (r.ok) {
        expect(r.value.label).toBe('My Place');
        expect(place.value.label).toBe('Home'); // original unchanged
        expect(r.value.id).toBe(place.value.id);
      }
    });

    it('rejects invalid new labels', () => {
      const place = SavedPlace.create({
        id: makeId(),
        label: 'Home',
        address: makeAddress(),
      });
      if (!place.ok) throw place.error;
      const r = place.value.withLabel('');
      expect(r.ok).toBe(false);
    });
  });

  describe('equals', () => {
    it('is true for matching id, label, and address', () => {
      const a = SavedPlace.create({
        id: makeId(),
        label: 'Home',
        address: makeAddress(),
      });
      const b = SavedPlace.create({
        id: makeId(),
        label: 'Home',
        address: makeAddress(),
      });
      if (a.ok && b.ok) expect(a.value.equals(b.value)).toBe(true);
    });

    it('is false when label differs', () => {
      const a = SavedPlace.create({
        id: makeId(),
        label: 'Home',
        address: makeAddress(),
      });
      const b = SavedPlace.create({
        id: makeId(),
        label: 'Work',
        address: makeAddress(),
      });
      if (a.ok && b.ok) expect(a.value.equals(b.value)).toBe(false);
    });
  });
});
