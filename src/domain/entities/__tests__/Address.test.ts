import { Address } from '../Address';
import { Coordinates } from '../Coordinates';

function makeCoords(): Coordinates {
  const r = Coordinates.create(37.4275, -122.1697);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('Address', () => {
  it('builds a valid address with placeId', () => {
    const r = Address.create({
      label: '1600 Amphitheatre Pkwy, Mountain View, CA',
      coordinates: makeCoords(),
      placeId: 'ChIJ2eUgeAK6j4ARbn5u_wAGqWA',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.label).toBe('1600 Amphitheatre Pkwy, Mountain View, CA');
      expect(r.value.placeId).toBe('ChIJ2eUgeAK6j4ARbn5u_wAGqWA');
      expect(r.value.coordinates.latitude).toBe(37.4275);
    }
  });

  it('builds without a placeId', () => {
    const r = Address.create({
      label: 'Some place',
      coordinates: makeCoords(),
    });
    if (r.ok) expect(r.value.placeId).toBeNull();
  });

  it('treats null and undefined placeId equivalently', () => {
    const a = Address.create({
      label: 'A',
      coordinates: makeCoords(),
      placeId: null,
    });
    const b = Address.create({
      label: 'A',
      coordinates: makeCoords(),
    });
    if (a.ok && b.ok) expect(a.value.placeId).toBe(b.value.placeId);
  });

  it('trims whitespace from the label', () => {
    const r = Address.create({
      label: '  HQ  ',
      coordinates: makeCoords(),
    });
    if (r.ok) expect(r.value.label).toBe('HQ');
  });

  it('rejects an empty label', () => {
    const r = Address.create({ label: '', coordinates: makeCoords() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('address_label_empty');
  });

  it('rejects a whitespace-only label', () => {
    const r = Address.create({ label: '    ', coordinates: makeCoords() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('address_label_empty');
  });

  it('rejects a label over 500 characters', () => {
    const r = Address.create({
      label: 'x'.repeat(501),
      coordinates: makeCoords(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('address_label_too_long');
  });

  it('rejects an empty placeId', () => {
    const r = Address.create({
      label: 'X',
      coordinates: makeCoords(),
      placeId: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('address_place_id_empty');
  });

  it('rejects non-string label', () => {
    const r = Address.create({
      label: 42 as unknown as string,
      coordinates: makeCoords(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('address_label_not_a_string');
  });

  it('compares by value', () => {
    const a = Address.create({ label: 'HQ', coordinates: makeCoords() });
    const b = Address.create({ label: 'HQ', coordinates: makeCoords() });
    const c = Address.create({ label: 'Other', coordinates: makeCoords() });
    if (a.ok && b.ok && c.ok) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.equals(c.value)).toBe(false);
    }
  });
});
