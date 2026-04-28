import { Money } from '../Money';
import { RideService } from '../RideService';
import { RideServiceId } from '../RideServiceId';
import { ServiceAreaId } from '../ServiceAreaId';

function rideServiceId(value: string) {
  const r = RideServiceId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function areaId(value: string) {
  const r = ServiceAreaId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(majorAmount: number) {
  const r = Money.fromMajor(majorAmount, 'USD');
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID_ECONOMY = {
  id: rideServiceId('economy'),
  areaId: areaId('us-fl-south-florida'),
  name: 'Economy',
  description: 'Affordable everyday rides',
  baseFare: usd(2.5),
  minimumFare: usd(5),
  cancelationFee: usd(2),
  seatCapacity: 4,
  costPerKm: usd(1.25),
  costPerMinute: usd(0.2),
};

describe('RideService', () => {
  it('constructs from valid props', () => {
    const r = RideService.create(VALID_ECONOMY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Economy');
      expect(r.value.seatCapacity).toBe(4);
      expect(r.value.baseFare.format()).toBe('$2.50');
      expect(r.value.costPerKm.format()).toBe('$1.25');
    }
  });

  it('rejects seatCapacity below 1', () => {
    const r = RideService.create({ ...VALID_ECONOMY, seatCapacity: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_invalid_seat_capacity');
  });

  it('rejects seatCapacity above 16', () => {
    const r = RideService.create({ ...VALID_ECONOMY, seatCapacity: 17 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_invalid_seat_capacity');
  });

  it('rejects non-integer seatCapacity', () => {
    const r = RideService.create({ ...VALID_ECONOMY, seatCapacity: 4.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_invalid_seat_capacity');
  });

  it('rejects an empty name', () => {
    const r = RideService.create({ ...VALID_ECONOMY, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_empty_name');
  });
});
