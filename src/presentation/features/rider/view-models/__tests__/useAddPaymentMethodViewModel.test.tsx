import { useStripe } from '@stripe/stripe-react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
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

import { useAddPaymentMethodViewModel } from '../useAddPaymentMethodViewModel';

/* ─── Test mocks ──────────────────────────────────────────────────── */

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

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

const mockedUseStripe = useStripe as jest.MockedFunction<typeof useStripe>;

/* ─── Helpers ─────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const FIXED_NOW = new Date('2026-04-29T12:00:00Z');
const RIDER_EMAIL = 'rider@yeapp.tech';
const SEEDED_CID = 'cus_existingRider001';

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly stripeServer: FakeStripeServerService;
  readonly uid: UserId;
}

async function setupRider(opts?: {
  readonly stripeCustomerId?: StripeCustomerId | null;
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
      stripeCustomerId: opts?.stripeCustomerId ?? null,
    }),
  );

  const stripeServer = new FakeStripeServerService();

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

/** Build a mocked `useStripe` return where confirmSetupIntent does the given thing. */
function mockStripe(impl: {
  readonly confirmSetupIntent?: ReturnType<typeof jest.fn>;
}) {
  // Cast to `never` to bypass the SDK's massive return-type interface — we
  // only care about confirmSetupIntent for these tests and the actual hook
  // returns ~30 unrelated methods we'd otherwise have to stub.
  mockedUseStripe.mockReturnValue({
    confirmSetupIntent:
      impl.confirmSetupIntent ??
      jest.fn().mockResolvedValue({ setupIntent: {} }),
  } as never);
}

/* ─── Tests ───────────────────────────────────────────────────────── */

describe('useAddPaymentMethodViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockedPublishableKey.mockReset();
    mockedPublishableKey.mockReturnValue('pk_test_default');
    mockedUseStripe.mockReset();
    mockStripe({});
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('reaches the unconfigured arm when no publishable key is set', async () => {
    mockedPublishableKey.mockReturnValue(null);
    const setup = await setupRider();

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    expect(result.current.state.kind).toBe('unconfigured');
  });

  it('starts idle with isCardComplete=false; onFormComplete flips it', async () => {
    const setup = await setupRider();

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    if (result.current.state.kind !== 'idle') throw new Error('not idle');
    expect(result.current.state.isCardComplete).toBe(false);

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });

    if (result.current.state.kind !== 'idle') throw new Error('not idle');
    expect(result.current.state.isCardComplete).toBe(true);
  });

  it('happy path: ensure → setupIntent → confirm → invalidate + goBack', async () => {
    const setup = await setupRider();
    const confirmFn = jest.fn().mockResolvedValue({
      setupIntent: { id: 'seti_123', status: 'Succeeded' },
    });
    mockStripe({ confirmSetupIntent: confirmFn });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });

    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
    expect(setup.stripeServer.spies.createCustomerCalls).toHaveLength(1);
    expect(setup.stripeServer.spies.createSetupIntentCalls).toHaveLength(1);
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it('skips ensureCustomer round-trip when rider already has a customerId', async () => {
    // EnsureStripeCustomer is idempotent: if the rider already has a
    // stripeCustomerId on their user doc, the use case returns it without
    // calling Stripe. The VM still calls the mutation — the round-trip
    // happens server-side in the use case, not Stripe-side.
    const cid = unwrap(StripeCustomerId.create(SEEDED_CID));
    const setup = await setupRider({ stripeCustomerId: cid });
    const confirmFn = jest.fn().mockResolvedValue({
      setupIntent: { id: 'seti_123' },
    });
    mockStripe({ confirmSetupIntent: confirmFn });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });
    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
    // No createCustomer call — the existing id was used.
    expect(setup.stripeServer.spies.createCustomerCalls).toHaveLength(0);
    expect(setup.stripeServer.spies.createSetupIntentCalls).toHaveLength(1);
  });

  it('CreateSetupIntent network failure surfaces as error: network', async () => {
    const setup = await setupRider();
    setup.stripeServer.failNext({
      method: 'createSetupIntent',
      error: { name: 'NetworkError', code: 'fake', message: 'boom' } as never,
    });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });
    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    if (result.current.state.kind !== 'error') throw new Error('not error');
    expect(result.current.state.error).toBe('network');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('confirmSetupIntent returning a card-declined error surfaces as error: card_declined', async () => {
    const setup = await setupRider();
    const confirmFn = jest.fn().mockResolvedValue({
      error: { code: 'Failed', message: 'Your card was declined.' },
    });
    mockStripe({ confirmSetupIntent: confirmFn });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });
    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    if (result.current.state.kind !== 'error') throw new Error('not error');
    expect(result.current.state.error).toBe('card_declined');
  });

  it('confirmSetupIntent returning Canceled is silent (no error banner)', async () => {
    const setup = await setupRider();
    const confirmFn = jest.fn().mockResolvedValue({
      error: { code: 'Canceled', message: 'User canceled' },
    });
    mockStripe({ confirmSetupIntent: confirmFn });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });
    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    // The state stays idle — no error, no goBack — and isSaving has cleared.
    await waitFor(() => {
      if (result.current.state.kind !== 'idle') throw new Error('not idle');
      expect(result.current.state.isSaving).toBe(false);
    });
    expect(result.current.state.kind).toBe('idle');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('confirmSetupIntent throwing maps to error: unknown', async () => {
    const setup = await setupRider();
    const confirmFn = jest.fn().mockRejectedValue(new Error('SDK threw'));
    mockStripe({ confirmSetupIntent: confirmFn });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });
    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    if (result.current.state.kind !== 'error') throw new Error('not error');
    expect(result.current.state.error).toBe('unknown');
  });

  it('onDismissError clears the error and returns to idle', async () => {
    const setup = await setupRider();
    setup.stripeServer.failNext({
      method: 'createSetupIntent',
      error: { name: 'NetworkError', code: 'fake', message: 'boom' } as never,
    });

    const { result } = renderHook(() => useAddPaymentMethodViewModel(), {
      wrapper: withTestContainer(setup),
    });

    act(() => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onFormComplete({ complete: true });
    });
    await act(async () => {
      if (result.current.state.kind !== 'idle') return;
      result.current.state.onSave();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });

    act(() => {
      if (result.current.state.kind !== 'error') return;
      result.current.state.onDismissError();
    });

    expect(result.current.state.kind).toBe('idle');
  });
});
