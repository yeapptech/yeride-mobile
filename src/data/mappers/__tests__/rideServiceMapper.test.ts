import { ServiceAreaId } from '@domain/entities/ServiceAreaId';

import { parseRideServiceDoc, toDomain } from '../rideServiceMapper';

function areaId() {
  const r = ServiceAreaId.create('us-fl-south-florida');
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID_DOC = {
  id: 'economy',
  name: 'Economy',
  description: 'Affordable everyday rides',
  baseFare: 2.5,
  minimumFare: 5,
  cancelationFee: 2,
  seat: 4,
  costPerKm: 1.25,
  costPerMinute: 0.2,
};

describe('parseRideServiceDoc', () => {
  it('accepts a fully-populated legacy doc with `seat` field', () => {
    const r = parseRideServiceDoc(VALID_DOC);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe('economy');
      expect(r.value.seat).toBe(4);
      expect(r.value.baseFare).toBe(2.5);
    }
  });

  it('accepts the new `seatCapacity` alias', () => {
    const r = parseRideServiceDoc({
      ...VALID_DOC,
      seat: undefined,
      seatCapacity: 4,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.seatCapacity).toBe(4);
  });

  it('accepts a doc with both seat fields (toDomain prefers seatCapacity)', () => {
    const r = parseRideServiceDoc({ ...VALID_DOC, seatCapacity: 6 });
    expect(r.ok).toBe(true);
  });

  it('defaults description to empty string when missing', () => {
    const { description: _description, ...rest } = VALID_DOC;
    const r = parseRideServiceDoc(rest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe('');
  });

  it('rejects a negative baseFare', () => {
    const r = parseRideServiceDoc({ ...VALID_DOC, baseFare: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_doc_invalid_shape');
  });
});

describe('toDomain', () => {
  it('builds a RideService and converts dollars to Money minor units', () => {
    const docR = parseRideServiceDoc(VALID_DOC);
    if (!docR.ok) throw docR.error;
    const r = toDomain('economy', areaId(), docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.value.id)).toBe('economy');
      expect(r.value.seatCapacity).toBe(4);
      expect(r.value.baseFare.format()).toBe('$2.50');
      expect(r.value.minimumFare.minorUnits).toBe(500);
      expect(r.value.costPerKm.format()).toBe('$1.25');
      expect(r.value.costPerMinute.minorUnits).toBe(20);
    }
  });

  it('prefers seatCapacity over seat when both are present', () => {
    const docR = parseRideServiceDoc({
      ...VALID_DOC,
      seat: 4,
      seatCapacity: 6,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('xl', areaId(), docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.seatCapacity).toBe(6);
  });

  it('errors when neither seat nor seatCapacity is set', () => {
    const docR = parseRideServiceDoc({
      ...VALID_DOC,
      seat: undefined,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('economy', areaId(), docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_doc_missing_seats');
  });

  it('rejects when the doc id is not a valid RideServiceId slug', () => {
    const docR = parseRideServiceDoc(VALID_DOC);
    if (!docR.ok) throw docR.error;
    const r = toDomain('NOT VALID', areaId(), docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_id_invalid_format');
  });
});
