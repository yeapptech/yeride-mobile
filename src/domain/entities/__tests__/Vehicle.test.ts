import { ValidationError } from '../../errors';
import { RideServiceId } from '../RideServiceId';
import { Vehicle } from '../Vehicle';
import { Vin } from '../Vin';

const VALID_VIN = '1HGBH41JXMN109186';
const FIXED_NOW = new Date('2026-04-28T12:00:00Z');
const LATER = new Date('2026-04-28T13:00:00Z');

function vin(): Vin {
  const r = Vin.create(VALID_VIN);
  if (!r.ok) throw r.error;
  return r.value;
}

function rsid(slug: string): RideServiceId {
  const r = RideServiceId.create(slug);
  if (!r.ok) throw r.error;
  return r.value;
}

function makeBaseArgs() {
  return {
    vin: vin(),
    make: 'Honda',
    model: 'Accord',
    year: 2020,
    vehicleClass: 'comfort' as const,
    eligibleServices: [rsid('economy'), rsid('comfort')],
    dataSource: 'vin_decoded' as const,
    createdAt: FIXED_NOW,
  };
}

describe('Vehicle.create', () => {
  it('produces a pending vehicle from minimum-required props', () => {
    const r = Vehicle.create(makeBaseArgs());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pending');
    expect(r.value.make).toBe('Honda');
    expect(r.value.year).toBe(2020);
    expect(r.value.photos.front).toBeNull();
    expect(r.value.eligibleServices).toHaveLength(2);
    expect(r.value.specs).toEqual({});
    expect(r.value.dataSource).toBe('vin_decoded');
    expect(r.value.verifiedAt).toBeNull();
    expect(r.value.deletedAt).toBeNull();
    expect(r.value.createdAt).toEqual(FIXED_NOW);
    expect(r.value.updatedAt).toEqual(FIXED_NOW);
  });

  it('rejects an empty make', () => {
    const r = Vehicle.create({ ...makeBaseArgs(), make: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_invalid_make');
  });

  it('rejects an empty model', () => {
    const r = Vehicle.create({ ...makeBaseArgs(), model: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_invalid_model');
  });

  it('rejects a year below 1900', () => {
    const r = Vehicle.create({ ...makeBaseArgs(), year: 1800 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_invalid_year');
  });

  it('rejects a non-integer year', () => {
    const r = Vehicle.create({ ...makeBaseArgs(), year: 2020.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_invalid_year');
  });

  it('rejects out-of-range seats', () => {
    const r = Vehicle.create({ ...makeBaseArgs(), seats: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_invalid_seats');
  });

  it('rejects out-of-range doors', () => {
    const r = Vehicle.create({ ...makeBaseArgs(), doors: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_invalid_doors');
  });
});

describe('Vehicle.approve', () => {
  it('flips pending → approved and sets verifiedAt', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.approve(LATER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('approved');
    expect(r.value.verifiedAt).toEqual(LATER);
    expect(r.value.updatedAt).toEqual(LATER);
  });

  it('flips suspended → approved (re-approval after lift)', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.approve(LATER);
    if (!v1.ok) throw v1.error;
    const v2 = v1.value.suspend({ at: LATER });
    if (!v2.ok) throw v2.error;
    const r = v2.value.approve(LATER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('approved');
  });

  it('rejects approve on a rejected vehicle', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.reject({ notes: 'bad photos', at: LATER });
    if (!v1.ok) throw v1.error;
    const r = v1.value.approve(LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_illegal_transition');
  });

  it('rejects approve on a deleted vehicle', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.markDeleted(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.approve(LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_illegal_transition');
  });
});

describe('Vehicle.reject', () => {
  it('flips pending → rejected and stores notes', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.reject({ notes: 'failed inspection', at: LATER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('rejected');
    expect(r.value.verificationNotes).toBe('failed inspection');
    expect(r.value.verifiedAt).toEqual(LATER);
  });

  it('rejects reject from an approved vehicle (use suspend instead)', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.approve(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.reject({ notes: 'x', at: LATER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_illegal_transition');
  });

  it('rejects reject with empty notes', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.reject({ notes: '   ', at: LATER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_reject_notes_required');
  });
});

describe('Vehicle.suspend', () => {
  it('flips approved → suspended', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.approve(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.suspend({ notes: 'expired insurance', at: LATER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('suspended');
    expect(r.value.verificationNotes).toBe('expired insurance');
  });

  it('rejects suspend from pending', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.suspend({ at: LATER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_illegal_transition');
  });
});

describe('Vehicle.markDeleted', () => {
  it('flips any non-deleted state → deleted and sets deletedAt', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.markDeleted(LATER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('deleted');
    expect(r.value.isDeleted).toBe(true);
    expect(r.value.deletedAt).toEqual(LATER);
  });

  it('rejects markDeleted on an already-deleted vehicle', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.markDeleted(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.markDeleted(LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_illegal_transition');
  });
});

describe('Vehicle.attachPhoto', () => {
  it('attaches a URL to the front slot', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.attachPhoto({
      type: 'front',
      url: 'memory://vehicles/1HGBH41JXMN109186/front_1.jpg',
      at: LATER,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.photos.front).toBe(
      'memory://vehicles/1HGBH41JXMN109186/front_1.jpg',
    );
    expect(r.value.photos.back).toBeNull();
    expect(r.value.updatedAt).toEqual(LATER);
  });

  it('overwrites an existing photo of the same type', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.attachPhoto({
      type: 'front',
      url: 'old',
      at: LATER,
    });
    if (!v1.ok) throw v1.error;
    const r = v1.value.attachPhoto({
      type: 'front',
      url: 'new',
      at: LATER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.photos.front).toBe('new');
  });

  it('rejects empty URL', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.attachPhoto({
      type: 'front',
      url: '   ',
      at: LATER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_photo_url_invalid');
  });

  it('rejects attachPhoto on a deleted vehicle', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.markDeleted(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.attachPhoto({
      type: 'front',
      url: 'x',
      at: LATER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_attach_photo_on_deleted');
  });
});

describe('Vehicle.setEligibleServices', () => {
  it('replaces the eligible-services list', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.setEligibleServices({
      services: [rsid('economy')],
      at: LATER,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.eligibleServices.map(String)).toEqual(['economy']);
  });

  it('allows clearing to an empty list', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.setEligibleServices({ services: [], at: LATER });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.eligibleServices).toEqual([]);
  });

  it('rejects setEligibleServices on a deleted vehicle', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.markDeleted(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.setEligibleServices({ services: [], at: LATER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_set_services_on_deleted');
  });
});

describe('Vehicle.setStockPhoto', () => {
  it('sets a stock-photo URL', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const r = v0.value.setStockPhoto({
      url: 'https://nhtsa/x.png',
      at: LATER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.stockPhoto).toBe('https://nhtsa/x.png');
  });

  it('clears a stock-photo URL', () => {
    const v0 = Vehicle.create({
      ...makeBaseArgs(),
      stockPhoto: 'https://prev/x.png',
    });
    if (!v0.ok) throw v0.error;
    const r = v0.value.setStockPhoto({ url: null, at: LATER });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.stockPhoto).toBeNull();
  });

  it('rejects setStockPhoto on a deleted vehicle', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.markDeleted(LATER);
    if (!v1.ok) throw v1.error;
    const r = v1.value.setStockPhoto({ url: 'x', at: LATER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_set_stock_photo_on_deleted');
  });
});

describe('Vehicle invariants', () => {
  it('returns a fresh instance on every transition (immutability)', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    const v1 = v0.value.approve(LATER);
    if (!v1.ok) throw v1.error;
    expect(v0.value.status).toBe('pending');
    expect(v1.value.status).toBe('approved');
    expect(v0.value).not.toBe(v1.value);
  });

  it('exposes isApproved + isDeleted helpers', () => {
    const v0 = Vehicle.create(makeBaseArgs());
    if (!v0.ok) throw v0.error;
    expect(v0.value.isApproved).toBe(false);
    expect(v0.value.isDeleted).toBe(false);
    const v1 = v0.value.approve(LATER);
    if (!v1.ok) throw v1.error;
    expect(v1.value.isApproved).toBe(true);
  });

  it('reject errors satisfy the shared ValidationError shape', () => {
    const v0 = Vehicle.create({ ...makeBaseArgs(), make: '' });
    expect(v0.ok).toBe(false);
    if (v0.ok) return;
    expect(v0.error).toBeInstanceOf(ValidationError);
    expect(v0.error.field).toBe('make');
  });
});
