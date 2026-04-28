import { DriverSnapshot, VehicleSnapshot } from '../DriverSnapshot';
import { Email } from '../Email';
import { PersonName } from '../PersonName';
import { PhoneNumber } from '../PhoneNumber';
import { UserId } from '../UserId';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID_VEHICLE = {
  make: 'Toyota',
  model: 'Camry',
  year: 2024,
  color: 'White',
  licensePlate: 'ABC1234',
  stockPhoto: 'https://example.com/camry.png',
  photos: [],
};

const VALID_DRIVER = {
  id: unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
  name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
  email: unwrap(Email.create('grace@yeapp.tech')),
  phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
  stripeAccountId: 'acct_abc123',
  pushToken: null,
  avatarUrl: null,
  vehicle: unwrap(VehicleSnapshot.create(VALID_VEHICLE)),
};

describe('VehicleSnapshot', () => {
  it('constructs from valid props', () => {
    const r = VehicleSnapshot.create(VALID_VEHICLE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.make).toBe('Toyota');
      expect(r.value.year).toBe(2024);
    }
  });

  it('rejects a non-integer year', () => {
    const r = VehicleSnapshot.create({ ...VALID_VEHICLE, year: 2024.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vehicle_snapshot_invalid_year');
  });

  it('rejects an out-of-range year', () => {
    const r = VehicleSnapshot.create({ ...VALID_VEHICLE, year: 1800 });
    expect(r.ok).toBe(false);
  });

  it('rejects an empty license plate', () => {
    const r = VehicleSnapshot.create({ ...VALID_VEHICLE, licensePlate: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.code).toBe('vehicle_snapshot_empty_license_plate');
  });
});

describe('DriverSnapshot', () => {
  it('constructs from valid props', () => {
    const r = DriverSnapshot.create(VALID_DRIVER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stripeAccountId).toBe('acct_abc123');
      expect(r.value.vehicle?.make).toBe('Toyota');
    }
  });

  it('accepts a snapshot with no vehicle (briefly null on legacy migrations)', () => {
    const r = DriverSnapshot.create({ ...VALID_DRIVER, vehicle: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.vehicle).toBeNull();
  });

  it('rejects an empty stripeAccountId', () => {
    const r = DriverSnapshot.create({ ...VALID_DRIVER, stripeAccountId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.code).toBe('driver_snapshot_empty_stripe_account');
  });
});
