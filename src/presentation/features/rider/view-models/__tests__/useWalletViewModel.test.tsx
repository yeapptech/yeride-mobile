import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { Email } from '@domain/entities/Email';
import { PaymentMethod } from '@domain/entities/PaymentMethod';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { makeRider } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import { getStripePublishableKey } from '@shared/env';
import {
  FakeStripeServerService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useWalletViewModel } from '../useWalletViewModel';

/* ─── Test mocks ──────────────────────────────────────────────────── */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

// Mock `@shared/env` so we can drive `getStripePublishableKey()` per-test.
// Re-export every other helper from the actual module so the rest of the
// codebase (DI container, etc.) sees its real implementations.
jest.mock('@shared/env', () => {
  const actual = jest.requireActual('@shared/env');
  return {
    ...actual,
    getStripePublishableKey: jest.fn(() => 'pk_test_default'),
  };
});

const mockedPublishableKey = getStripePublishableKey as jest.MockedFunction<
  typeof getStripePublishableKey
>;

/* ─── Helpers ─────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const FIXED_NOW = new Date('2026-04-29T12:00:00Z');
const RIDER_EMAIL = 'rider@yeapp.tech';
// Stripe ids are validated as `^(cus|pm)_[A-Za-z0-9]{1,255}$` — alphanumeric
// body, no underscores. Use Stripe's test fixture style.
const CUSTOMER_ID_RAW = 'cusTestRider001';
const PM_VISA_RAW = 'pmVisaTest001';
const PM_MC_RAW = 'pmMcTest002';

// Helpers prepend the prefix on the raw stem so error messages stay grep-able.
const CID = `cus_${CUSTOMER_ID_RAW}`;
const PM_VISA = `pm_${PM_VISA_RAW}`;
const PM_MC = `pm_${PM_MC_RAW}`;

function customerId(value: string): StripeCustomerId {
  return unwrap(StripeCustomerId.create(value));
}

function paymentMethodId(value: string): PaymentMethodId {
  return unwrap(PaymentMethodId.create(value));
}

function makePM(args: {
  id: string;
  brand?: 'visa' | 'mastercard';
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

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly stripeServer: FakeStripeServerService;
  readonly uid: UserId;
}

async function setupRider(opts: {
  readonly stripeCustomerId?: StripeCustomerId | null;
  readonly defaultPaymentMethodId?: PaymentMethodId | null;
  readonly seededMethods?: readonly PaymentMethod[];
}): Promise<SeededState> {
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
      defaultPaymentMethodId: opts.defaultPaymentMethodId ?? null,
    }),
  );

  const stripeServer = new FakeStripeServerService();
  if (opts.stripeCustomerId !== null && opts.stripeCustomerId !== undefined) {
    if (opts.seededMethods && opts.seededMethods.length > 0) {
      stripeServer.seedPaymentMethods({
        customerId: opts.stripeCustomerId,
        methods: opts.seededMethods,
      });
    } else {
      // Seed an empty list so `listPaymentMethods` returns ok([]) instead
      // of failing with the "unprimed method" error the fake throws by
      // default.
      stripeServer.seedPaymentMethods({
        customerId: opts.stripeCustomerId,
        methods: [],
      });
    }
  }

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, stripeServer, uid };
}

function withTestContainer(setup: SeededState) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      stripeServer={setup.stripeServer}
    >
      {children}
    </TestContainerProvider>
  );
}

/* ─── Tests ───────────────────────────────────────────────────────── */

describe('useWalletViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockedPublishableKey.mockReset();
    mockedPublishableKey.mockReturnValue('pk_test_default');
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('reaches the unconfigured arm when no publishable key is configured', async () => {
    mockedPublishableKey.mockReturnValue(null);
    const setup = await setupRider({ stripeCustomerId: null });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    expect(result.current.state.kind).toBe('unconfigured');
  });

  it('reaches the no_customer arm when rider has no stripeCustomerId', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const setup = await setupRider({ stripeCustomerId: null });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('no_customer');
    });
    act(() => {
      if (result.current.state.kind !== 'no_customer') return;
      result.current.state.onAdd();
    });
    expect(mockNavigate).toHaveBeenCalledWith('AddPaymentMethod');
  });

  it('reaches the empty arm when rider has a customerId but no cards', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const setup = await setupRider({
      stripeCustomerId: cid,
      seededMethods: [],
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('empty');
    });
    if (result.current.state.kind !== 'empty') throw new Error('not empty');
    expect(String(result.current.state.customerId)).toBe(CID);
  });

  it('reaches the ready arm with default highlighted', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const visa = makePM({ id: PM_VISA, brand: 'visa', last4: '4242' });
    const mc = makePM({ id: PM_MC, brand: 'mastercard', last4: '5555' });
    const setup = await setupRider({
      stripeCustomerId: cid,
      defaultPaymentMethodId: paymentMethodId(PM_VISA),
      seededMethods: [visa, mc],
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');
    expect(result.current.state.methods).toHaveLength(2);
    expect(String(result.current.state.defaultMethodId)).toBe(PM_VISA);
  });

  it('onSetDefault fires the mutation with the right paymentMethodId', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const visa = makePM({ id: PM_VISA });
    const mc = makePM({ id: PM_MC });
    const setup = await setupRider({
      stripeCustomerId: cid,
      defaultPaymentMethodId: paymentMethodId(PM_VISA),
      seededMethods: [visa, mc],
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');

    await act(async () => {
      if (result.current.state.kind !== 'ready') return;
      result.current.state.onSetDefault(paymentMethodId(PM_MC));
      await Promise.resolve();
    });

    // The `setDefaultPaymentMethod` use case writes back to the user
    // repository — assert via the repo's persisted state.
    await waitFor(async () => {
      const updated = await setup.usersRepo.getById(setup.uid);
      if (!updated.ok) throw new Error('user gone');
      const u = updated.value;
      expect(u.role === 'rider' ? String(u.defaultPaymentMethodId) : null).toBe(
        PM_MC,
      );
    });
  });

  it('onDelete pops Alert; tap Remove fires detach', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const visa = makePM({ id: PM_VISA });
    const mc = makePM({ id: PM_MC });
    const setup = await setupRider({
      stripeCustomerId: cid,
      defaultPaymentMethodId: paymentMethodId(PM_VISA),
      seededMethods: [visa, mc],
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // no-op
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });
    if (result.current.state.kind !== 'ready') throw new Error('not ready');

    act(() => {
      if (result.current.state.kind !== 'ready') return;
      result.current.state.onDelete(paymentMethodId(PM_MC));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, , buttons] = alertSpy.mock.calls[0] ?? [];
    const removeButton = (
      buttons as { text: string; onPress?: () => void }[]
    ).find((b) => b.text === 'Remove');
    expect(removeButton).toBeDefined();

    await act(async () => {
      removeButton?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setup.stripeServer.spies.detachCalls).toHaveLength(1);
    });
    expect(
      String(setup.stripeServer.spies.detachCalls[0]?.paymentMethodId),
    ).toBe(PM_MC);
  });

  it('onDelete of the default-and-only card surfaces the extra-warning copy', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const visa = makePM({ id: PM_VISA });
    const setup = await setupRider({
      stripeCustomerId: cid,
      defaultPaymentMethodId: paymentMethodId(PM_VISA),
      seededMethods: [visa],
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // no-op
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      if (result.current.state.kind !== 'ready') return;
      result.current.state.onDelete(paymentMethodId(PM_VISA));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message] = alertSpy.mock.calls[0] ?? [];
    expect(message).toContain('only card on file');
  });

  it('onDelete of the default (with siblings) surfaces the default-card warning', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const visa = makePM({ id: PM_VISA });
    const mc = makePM({ id: PM_MC });
    const setup = await setupRider({
      stripeCustomerId: cid,
      defaultPaymentMethodId: paymentMethodId(PM_VISA),
      seededMethods: [visa, mc],
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // no-op
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      if (result.current.state.kind !== 'ready') return;
      result.current.state.onDelete(paymentMethodId(PM_VISA));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message] = alertSpy.mock.calls[0] ?? [];
    expect(message).toContain('default card');
    expect(message).not.toContain('only card');
  });

  it('reaches the error arm when listPaymentMethods fails', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const setup = await setupRider({
      stripeCustomerId: cid,
      seededMethods: [],
    });
    // Prime the next listPaymentMethods to fail with a network error.
    setup.stripeServer.failNext({
      method: 'listPaymentMethods',
      error: { name: 'NetworkError', code: 'fake', message: 'boom' } as never,
    });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
  });

  it('onAdd from no_customer arm navigates to AddPaymentMethod', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const setup = await setupRider({ stripeCustomerId: null });

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('no_customer');
    });

    act(() => {
      if (result.current.state.kind !== 'no_customer') return;
      result.current.state.onAdd();
    });
    expect(mockNavigate).toHaveBeenCalledWith('AddPaymentMethod');
  });

  it('per-card inFlight tracking surfaces during a slow setDefault', async () => {
    mockedPublishableKey.mockReturnValue('pk_test_x');
    const cid = customerId(CID);
    const visa = makePM({ id: PM_VISA });
    const mc = makePM({ id: PM_MC });
    const setup = await setupRider({
      stripeCustomerId: cid,
      defaultPaymentMethodId: paymentMethodId(PM_VISA),
      seededMethods: [visa, mc],
    });

    // Slow the user-update path so we can observe the in-flight flag.
    const originalUpdate = setup.usersRepo.update.bind(setup.usersRepo);
    setup.usersRepo.update = jest.fn(async (u) => {
      await new Promise((r) => setTimeout(r, 20));
      return originalUpdate(u);
    }) as typeof setup.usersRepo.update;

    const { result } = renderHook(() => useWalletViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready');
    });

    act(() => {
      if (result.current.state.kind !== 'ready') return;
      result.current.state.onSetDefault(paymentMethodId(PM_MC));
    });

    // Immediately after firing, the inFlight set should contain the id.
    expect(
      result.current.state.kind === 'ready'
        ? result.current.state.inFlight.setDefault.has(PM_MC)
        : false,
    ).toBe(true);

    await waitFor(() => {
      if (result.current.state.kind !== 'ready') return;
      expect(result.current.state.inFlight.setDefault.has(PM_MC)).toBe(false);
    });
  });
});
