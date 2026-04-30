import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import { Email } from '@domain/entities/Email';
import { Money } from '@domain/entities/Money';
import { Payout } from '@domain/entities/Payout';
import { PersonName } from '@domain/entities/PersonName';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { makeDriver, makeRider } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import { buildDeepLink, getStripePublishableKey } from '@shared/env';
import {
  FakeStripeServerService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useDriverEarningsViewModel } from '../useDriverEarningsViewModel';

/* ─── Test mocks ──────────────────────────────────────────────────── */

const focusCallbacks: (() => void)[] = [];
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    focusCallbacks.push(cb);
    cb();
  },
}));

jest.mock('expo-web-browser', () => ({
  __esModule: true,
  openAuthSessionAsync: jest.fn(async () => ({
    type: 'success',
    url: 'yeridenext-dev://stripe-return',
  })),
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
}));

jest.mock('@shared/env', () => {
  const actual = jest.requireActual('@shared/env');
  return {
    ...actual,
    getStripePublishableKey: jest.fn(() => 'pk_test_default'),
    buildDeepLink: jest.fn((path: string) => `yeridenext-dev://${path}`),
  };
});

jest.mock('react-native-toast-message', () => {
  const show = jest.fn();
  const hide = jest.fn();
  function ToastComponent() {
    return null;
  }
  ToastComponent.show = show;
  ToastComponent.hide = hide;
  return { __esModule: true, default: ToastComponent };
});

const mockedPublishableKey = getStripePublishableKey as jest.MockedFunction<
  typeof getStripePublishableKey
>;
const mockedBuildDeepLink = buildDeepLink as jest.MockedFunction<
  typeof buildDeepLink
>;
const mockedOpenAuthSession =
  WebBrowser.openAuthSessionAsync as jest.MockedFunction<
    typeof WebBrowser.openAuthSessionAsync
  >;
const mockedOpenBrowser = WebBrowser.openBrowserAsync as jest.MockedFunction<
  typeof WebBrowser.openBrowserAsync
>;

/* ─── Helpers ─────────────────────────────────────────────────────── */

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const FIXED_NOW = new Date('2026-04-29T12:00:00Z');
const DRIVER_EMAIL = 'driver@yeapp.tech';
const SEEDED_AID = 'acct_existingDriver001';

interface SeededState {
  readonly authRepo: InMemoryAuthRepository;
  readonly usersRepo: InMemoryUserRepository;
  readonly stripeServer: FakeStripeServerService;
  readonly uid: UserId;
}

async function setupDriver(opts?: {
  readonly stripeAccountId?: StripeAccountId | null;
  readonly chargesEnabled?: boolean;
  readonly payoutsEnabled?: boolean;
}): Promise<SeededState> {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: DRIVER_EMAIL, password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create(DRIVER_EMAIL)),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const usersRepo = new InMemoryUserRepository();
  usersRepo.seed(
    makeDriver({
      id: uid,
      email: unwrap(Email.create(DRIVER_EMAIL)),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      stripeAccountId: opts?.stripeAccountId ?? null,
      stripeChargesEnabled: opts?.chargesEnabled ?? false,
      stripePayoutsEnabled: opts?.payoutsEnabled ?? false,
    }),
  );

  const stripeServer = new FakeStripeServerService();
  useSessionStore.getState().setSignedIn(uid);
  return { authRepo, usersRepo, stripeServer, uid };
}

async function setupRiderForMisroute(): Promise<SeededState> {
  const authRepo = new InMemoryAuthRepository();
  authRepo.seedAccount({ email: 'rider@yeapp.tech', password: 'hunter22' });
  await authRepo.signIn({
    email: unwrap(Email.create('rider@yeapp.tech')),
    password: 'hunter22',
  });
  const uid = (await authRepo.currentUserId()) as UserId;

  const usersRepo = new InMemoryUserRepository();
  usersRepo.seed(
    makeRider({
      id: uid,
      email: unwrap(Email.create('rider@yeapp.tech')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
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

function usd(major: number): Money {
  return unwrap(Money.fromMajor(major, 'USD'));
}

function makePayout(args: {
  readonly id: string;
  readonly amountMajor: number;
}): Payout {
  return unwrap(
    Payout.create({
      id: args.id,
      amount: usd(args.amountMajor),
      status: 'paid',
      arrivalDate: FIXED_NOW,
    }),
  );
}

function makeBalanceTxn(args: {
  readonly id: string;
  readonly amountMajor: number;
  readonly feeMajor?: number;
}): BalanceTransaction {
  const fee = usd(args.feeMajor ?? 0);
  const amount = usd(args.amountMajor);
  const net = unwrap(Money.create(amount.minorUnits - fee.minorUnits, 'USD'));
  return unwrap(
    BalanceTransaction.create({
      id: args.id,
      amount,
      fee,
      net,
      createdAt: FIXED_NOW,
      type: 'charge',
      tripId: null,
    }),
  );
}

function seedEnabledData(
  stripe: FakeStripeServerService,
  aid: StripeAccountId,
) {
  stripe.seedConnectAccount({
    accountId: aid,
    chargesEnabled: true,
    payoutsEnabled: true,
  });
  stripe.seedBalance({
    accountId: aid,
    available: usd(124.5),
    pending: usd(36.0),
  });
  stripe.seedPayouts({
    accountId: aid,
    payouts: [makePayout({ id: 'po_1', amountMajor: 50 })],
  });
  stripe.seedBalanceTransactions({
    accountId: aid,
    transactions: [
      makeBalanceTxn({ id: 'txn_1', amountMajor: 25, feeMajor: 1 }),
    ],
  });
}

/* ─── Tests ───────────────────────────────────────────────────────── */

describe('useDriverEarningsViewModel', () => {
  beforeEach(() => {
    focusCallbacks.length = 0;
    mockedPublishableKey.mockReset();
    mockedPublishableKey.mockReturnValue('pk_test_default');
    mockedBuildDeepLink.mockReset();
    mockedBuildDeepLink.mockImplementation(
      (path: string) => `yeridenext-dev://${path}`,
    );
    mockedOpenAuthSession.mockReset();
    mockedOpenAuthSession.mockResolvedValue({
      type: 'success',
      url: 'yeridenext-dev://stripe-return',
    });
    mockedOpenBrowser.mockReset();
    mockedOpenBrowser.mockResolvedValue({ type: 'opened' } as never);
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('reaches unconfigured arm when no publishable key is set', async () => {
    mockedPublishableKey.mockReturnValue(null);
    const setup = await setupDriver({ stripeAccountId: null });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    expect(result.current.state.kind).toBe('unconfigured');
  });

  it('reaches unconfigured arm for a misrouted rider', async () => {
    const setup = await setupRiderForMisroute();

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('unconfigured');
    });
  });

  it('reaches loading arm while currentUser query is in flight', async () => {
    const setup = await setupDriver({ stripeAccountId: null });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    // First synchronous render — userQuery hasn't resolved yet.
    expect(result.current.state.kind).toBe('loading');
  });

  it('reaches no_account arm with onSetupPayouts CTA', async () => {
    const setup = await setupDriver({ stripeAccountId: null });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('no_account');
    });
    if (result.current.state.kind !== 'no_account')
      throw new Error('not no_account');
    expect(typeof result.current.state.onSetupPayouts).toBe('function');
    expect(result.current.state.isOnboarding).toBe(false);
  });

  it('onSetupPayouts triggers the onboarding hook', async () => {
    const setup = await setupDriver({ stripeAccountId: null });
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    setup.stripeServer.seedConnectAccount({
      accountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    setup.stripeServer.seedAccountLink({
      accountId: aid,
      url: 'https://connect.stripe.com/setup/abc',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('no_account');
    });

    await act(async () => {
      if (result.current.state.kind !== 'no_account') return;
      result.current.state.onSetupPayouts();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setup.stripeServer.spies.createConnectCalls).toHaveLength(1);
    });
    expect(mockedOpenAuthSession).toHaveBeenCalledTimes(1);
  });

  it('reaches pending arm when account exists but flags are incomplete', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: false,
    });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('pending');
    });
    if (result.current.state.kind !== 'pending') throw new Error('not pending');
    expect(String(result.current.state.accountId)).toBe(SEEDED_AID);
  });

  it('reaches enabled arm with balance + payouts + balance txns populated', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    seedEnabledData(setup.stripeServer, aid);

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('enabled');
    });
    if (result.current.state.kind !== 'enabled') throw new Error('not enabled');
    expect(result.current.state.available.minorUnits).toBe(12_450);
    expect(result.current.state.pending.minorUnits).toBe(3_600);
    expect(result.current.state.payouts).toHaveLength(1);
    expect(result.current.state.balanceTxns).toHaveLength(1);
  });

  it('onViewExpressDashboard mints a login link and opens the browser', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    seedEnabledData(setup.stripeServer, aid);
    setup.stripeServer.seedAccountLoginLink({
      accountId: aid,
      url: 'https://connect.stripe.com/express/login/xyz',
    });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('enabled');
    });

    await act(async () => {
      if (result.current.state.kind !== 'enabled') return;
      result.current.state.onViewExpressDashboard();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(setup.stripeServer.spies.createAccountLoginLinkCalls).toHaveLength(
        1,
      );
    });
    await waitFor(() => {
      expect(mockedOpenBrowser).toHaveBeenCalledWith(
        'https://connect.stripe.com/express/login/xyz',
      );
    });
  });

  it('onViewExpressDashboard surfaces an Alert on network failure', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    seedEnabledData(setup.stripeServer, aid);
    setup.stripeServer.failNext({
      method: 'createAccountLoginLink',
      error: new NetworkError({ code: 'fake', message: 'boom' }),
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('enabled');
    });

    await act(async () => {
      if (result.current.state.kind !== 'enabled') return;
      result.current.state.onViewExpressDashboard();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });
    expect(mockedOpenBrowser).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('reaches error arm when one of the queries fails', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    setup.stripeServer.seedConnectAccount({
      accountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    setup.stripeServer.failNext({
      method: 'getAccountBalance',
      error: new NetworkError({ code: 'fake', message: 'boom' }),
    });
    setup.stripeServer.seedPayouts({ accountId: aid, payouts: [] });
    setup.stripeServer.seedBalanceTransactions({
      accountId: aid,
      transactions: [],
    });

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    if (result.current.state.kind !== 'error') throw new Error('not error');
    expect(typeof result.current.state.onRetry).toBe('function');
  });

  it('useFocusEffect kicks the status refresh on every focus', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    seedEnabledData(setup.stripeServer, aid);

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('enabled');
    });

    // The mounted focus effect ran once on mount; re-firing the recorded
    // callback simulates a fresh screen focus.
    await act(async () => {
      const cb = focusCallbacks[focusCallbacks.length - 1];
      cb?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        setup.stripeServer.spies.retrieveAccountCalls.length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('onRefresh fans out to all three queries + status mutation', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    seedEnabledData(setup.stripeServer, aid);

    const { result } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('enabled');
    });

    const balanceCallsBefore =
      setup.stripeServer.spies.getAccountBalanceCalls.length;
    const payoutCallsBefore =
      setup.stripeServer.spies.listAccountPayoutsCalls.length;
    const txnCallsBefore =
      setup.stripeServer.spies.listBalanceTransactionsCalls.length;
    const statusCallsBefore =
      setup.stripeServer.spies.retrieveAccountCalls.length;

    await act(async () => {
      if (result.current.state.kind !== 'enabled') return;
      result.current.state.onRefresh();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        setup.stripeServer.spies.getAccountBalanceCalls.length,
      ).toBeGreaterThan(balanceCallsBefore);
      expect(
        setup.stripeServer.spies.listAccountPayoutsCalls.length,
      ).toBeGreaterThan(payoutCallsBefore);
      expect(
        setup.stripeServer.spies.listBalanceTransactionsCalls.length,
      ).toBeGreaterThan(txnCallsBefore);
      expect(
        setup.stripeServer.spies.retrieveAccountCalls.length,
      ).toBeGreaterThan(statusCallsBefore);
    });
  });

  it('AppState change to active kicks the status refresh', async () => {
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    const setup = await setupDriver({
      stripeAccountId: aid,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    seedEnabledData(setup.stripeServer, aid);

    let registered: ((s: string) => void) | null = null;
    const remove = jest.fn();
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_evt, cb) => {
        registered = cb as (s: string) => void;
        return { remove } as never;
      });

    const { result, unmount } = renderHook(() => useDriverEarningsViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('enabled');
    });

    const callsBefore = setup.stripeServer.spies.retrieveAccountCalls.length;
    await act(async () => {
      registered?.('active');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        setup.stripeServer.spies.retrieveAccountCalls.length,
      ).toBeGreaterThan(callsBefore);
    });

    unmount();
    expect(remove).toHaveBeenCalled();
    addEventListenerSpy.mockRestore();
  });
});
