import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PaymentMethod } from '@domain/entities/PaymentMethod';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import type { TripPayment } from '@domain/entities/TripPayment';
import { makeRider } from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  FakeStripeServerService,
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useRideReceiptViewModel } from '../useRideReceiptViewModel';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('rideAbcDef1234567890ab'));

function makeCompletedRide(): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const tier = unwrap(
    RideServiceSnapshot.create({
      id: unwrap(RideServiceId.create('economy')),
      name: 'Economy',
      baseFare: usd(2.5),
      minimumFare: usd(5),
      cancelationFee: usd(2),
      costPerKm: usd(1.25),
      costPerMinute: usd(0.2),
      seatCapacity: 4,
    }),
  );
  return unwrap(
    Ride.fromProps({
      id: RIDE_ID,
      status: 'completed',
      passenger,
      driver: null,
      rideService: tier,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'Bayfront Park',
          placeName: 'Bayfront Park',
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: '1 Las Olas Blvd',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date('2026-04-28T10:00:00Z'),
      pickupTiming: {
        startedAt: new Date('2026-04-28T10:00:00Z'),
        completedAt: new Date('2026-04-28T10:05:00Z'),
        odometerMeters: 0,
        elapsedSeconds: 300,
      },
      dropoffTiming: {
        startedAt: new Date('2026-04-28T10:05:00Z'),
        completedAt: new Date('2026-04-28T10:30:00Z'),
        odometerMeters: 10_000,
      },
      cancellation: null,
      routePreference: null,
      schedulePickupAt: null,
      paymentFailure: null,
    }),
  );
}

const FARE: TripPayment = {
  id: 'pay-fare',
  type: 'fare',
  amount: usd(18),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:30:30Z'),
  paymentMethodId: null,
};
const TIP: TripPayment = {
  id: 'pay-tip',
  type: 'tip',
  amount: usd(2),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:32:00Z'),
  paymentMethodId: null,
};
const REFUND: TripPayment = {
  id: 'pay-refund',
  type: 'refund',
  amount: usd(5),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T10:35:00Z'),
  paymentMethodId: null,
};

function withTestContainer(opts: { ridesRepo: InMemoryRideRepository }) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={opts.ridesRepo}>
      {children}
    </TestContainerProvider>
  );
}

describe('useRideReceiptViewModel', () => {
  it('emits the ride after the query resolves', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );

    await waitFor(() => {
      expect(result.current.ride?.id).toBe(RIDE_ID);
    });
    expect(result.current.ride?.status).toBe('completed');
  });

  it('emits empty payments when the subcollection is empty', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.ride).not.toBeUndefined();
    });
    expect(result.current.payments).toEqual([]);
    expect(result.current.fareTotal).toBeNull();
  });

  it('derives fareTotal from the seeded fare row', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    ridesRepo.seedPayments(RIDE_ID, [FARE]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.farePayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.majorUnits).toBe(18);
  });

  it('adds a tip into the fareTotal when present', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    ridesRepo.seedPayments(RIDE_ID, [FARE, TIP]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.tipPayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.majorUnits).toBe(20); // 18 + 2
  });

  it('subtracts a refund from the fareTotal when present', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    ridesRepo.seedPayments(RIDE_ID, [FARE, TIP, REFUND]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.refundPayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.majorUnits).toBe(15); // 18 + 2 − 5
  });

  it('clamps fareTotal to zero if the refund exceeds the charge', async () => {
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    const oversizedRefund: TripPayment = {
      ...REFUND,
      amount: usd(100),
    };
    ridesRepo.seedPayments(RIDE_ID, [FARE, oversizedRefund]);

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.refundPayment).not.toBeNull();
    });
    expect(result.current.fareTotal?.minorUnits).toBe(0);
  });
});

/* ─── Card brand + last-4 join (Phase 9 Turn 7) ──────────────────── */

const CID_RAW = 'cusReceiptRider001';
const PM_VISA_RAW = 'pmVisaReceipt001';
const PM_MC_RAW = 'pmMcReceipt002';
const CID = `cus_${CID_RAW}`;
const PM_VISA = `pm_${PM_VISA_RAW}`;
const PM_MC = `pm_${PM_MC_RAW}`;
const RIDER_EMAIL = 'rider-receipt@yeapp.tech';
const FIXED_NOW = new Date('2026-04-29T12:00:00Z');

function customerId(value: string): StripeCustomerId {
  return unwrap(StripeCustomerId.create(value));
}
function paymentMethodId(value: string): PaymentMethodId {
  return unwrap(PaymentMethodId.create(value));
}
function makePM(args: {
  id: string;
  brand?: 'visa' | 'mastercard' | 'amex';
  last4?: string;
}): PaymentMethod {
  return unwrap(
    PaymentMethod.create({
      id: paymentMethodId(args.id),
      brand: args.brand ?? 'visa',
      last4: args.last4 ?? '4242',
      expiry: null,
    }),
  );
}

interface ReceiptSetup {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly ridesRepo: InMemoryRideRepository;
  readonly stripeServer: FakeStripeServerService;
  readonly uid: UserId;
}

async function setupReceipt(opts: {
  readonly stripeCustomerId?: StripeCustomerId | null;
  readonly seededMethods?: readonly PaymentMethod[];
  readonly farePaymentMethodId?: PaymentMethodId | null;
}): Promise<ReceiptSetup> {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: RIDER_EMAIL, password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create(RIDER_EMAIL)),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const usersRepo = new InMemoryUserRepository();
  usersRepo.seed(
    makeRider({
      id: uid,
      email: unwrap(Email.create(RIDER_EMAIL)),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeCustomerId: opts.stripeCustomerId ?? null,
      defaultPaymentMethodId: null,
    }),
  );

  const ridesRepo = new InMemoryRideRepository();
  ridesRepo.seed(makeCompletedRide());
  // Build a fare row carrying the requested paymentMethodId. When
  // `farePaymentMethodId === undefined`, omit the field (defaults to
  // null on TripPayment).
  const fareWithPm: TripPayment = {
    ...FARE,
    paymentMethodId: opts.farePaymentMethodId ?? null,
  };
  ridesRepo.seedPayments(RIDE_ID, [fareWithPm]);

  const stripeServer = new FakeStripeServerService();
  if (opts.stripeCustomerId) {
    stripeServer.seedPaymentMethods({
      customerId: opts.stripeCustomerId,
      methods: opts.seededMethods ?? [],
    });
  }

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, ridesRepo, stripeServer, uid };
}

function withSeeded(setup: ReceiptSetup) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      rides={setup.ridesRepo}
      stripeServer={setup.stripeServer}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useRideReceiptViewModel — paymentBrand + paymentLast4 join', () => {
  beforeEach(() => {
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('surfaces brand+last4 when fare paymentMethodId hits the wallet cache', async () => {
    const visa = makePM({ id: PM_VISA, brand: 'visa', last4: '4242' });
    const setup = await setupReceipt({
      stripeCustomerId: customerId(CID),
      seededMethods: [visa],
      farePaymentMethodId: paymentMethodId(PM_VISA),
    });

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withSeeded(setup) },
    );

    await waitFor(() => {
      expect(result.current.paymentBrand).toBe('visa');
    });
    expect(result.current.paymentLast4).toBe('4242');
  });

  it('returns null brand+last4 when paymentMethodId is missing on the fare row', async () => {
    // No paymentMethodId on the fare doc — the join can't run. Cache
    // is fully populated; the absence is on the wire, not in the
    // wallet. Surfaces the "Charged to your card on file" fallback.
    const visa = makePM({ id: PM_VISA });
    const setup = await setupReceipt({
      stripeCustomerId: customerId(CID),
      seededMethods: [visa],
      farePaymentMethodId: null,
    });

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withSeeded(setup) },
    );

    await waitFor(() => {
      expect(result.current.farePayment).not.toBeNull();
    });
    expect(result.current.paymentBrand).toBeNull();
    expect(result.current.paymentLast4).toBeNull();
  });

  it('returns null when the rider has no Stripe customer record', async () => {
    // No customerId → useListPaymentMethodsQuery is gated off →
    // methodsQuery.data stays undefined → join misses. Same fallback
    // as cache-hit-but-no-paymentMethodId.
    const setup = await setupReceipt({
      stripeCustomerId: null,
      farePaymentMethodId: paymentMethodId(PM_VISA),
    });

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withSeeded(setup) },
    );

    await waitFor(() => {
      expect(result.current.farePayment).not.toBeNull();
    });
    expect(result.current.paymentBrand).toBeNull();
    expect(result.current.paymentLast4).toBeNull();
  });

  it('returns null when the wallet cache is populated but the pm_id is not in it', async () => {
    // Card was detached after the trip OR a stale fare row points at
    // a method the rider never saved. Surfaces the brand-agnostic
    // fallback rather than rendering wrong card data.
    const mc = makePM({ id: PM_MC, brand: 'mastercard', last4: '4444' });
    const setup = await setupReceipt({
      stripeCustomerId: customerId(CID),
      seededMethods: [mc], // wallet has MC only
      farePaymentMethodId: paymentMethodId(PM_VISA), // fare row points at Visa
    });

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper: withSeeded(setup) },
    );

    await waitFor(() => {
      expect(result.current.farePayment).not.toBeNull();
    });
    expect(result.current.paymentBrand).toBeNull();
    expect(result.current.paymentLast4).toBeNull();
  });

  it('returns null when the fare row has not landed yet (live trip mid-completion)', async () => {
    // Edge case: receipt screen opened before the webhook wrote the
    // payment row. payments[] is empty → farePayment is null →
    // matchedMethod is null. The screen shows "Total updates as soon
    // as your charge clears." copy until the row arrives.
    const visa = makePM({ id: PM_VISA });
    const authRepo = new InMemoryAuthRepository();
    authRepo.seedAccount({ email: RIDER_EMAIL, password: 'hunter22' });
    await authRepo.signIn({
      email: unwrap(Email.create(RIDER_EMAIL)),
      password: 'hunter22',
    });
    const uid = (await authRepo.currentUserId()) as UserId;

    const usersRepo = new InMemoryUserRepository();
    usersRepo.seed(
      makeRider({
        id: uid,
        email: unwrap(Email.create(RIDER_EMAIL)),
        name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        stripeCustomerId: customerId(CID),
        defaultPaymentMethodId: null,
      }),
    );
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeCompletedRide());
    // Note: no payments seeded.
    const stripeServer = new FakeStripeServerService();
    stripeServer.seedPaymentMethods({
      customerId: customerId(CID),
      methods: [visa],
    });
    useSessionStore.getState().setSignedIn(uid);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestContainerProvider
        auth={authRepo}
        users={usersRepo}
        rides={ridesRepo}
        stripeServer={stripeServer}
      >
        {children}
      </TestContainerProvider>
    );

    const { result } = renderHook(
      () => useRideReceiptViewModel({ rideId: RIDE_ID }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.ride).not.toBeNull();
    });
    expect(result.current.farePayment).toBeNull();
    expect(result.current.paymentBrand).toBeNull();
    expect(result.current.paymentLast4).toBeNull();
  });
});
