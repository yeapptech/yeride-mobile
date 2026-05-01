import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';

import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { makeDriver } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import { buildDeepLink } from '@shared/env';
import {
  FakeStripeServerService,
  InMemoryAuthRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useStripeConnectOnboarding } from '../useStripeConnectOnboarding';

/* ─── Test mocks ──────────────────────────────────────────────────── */

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

const mockedOpenAuthSession =
  WebBrowser.openAuthSessionAsync as jest.MockedFunction<
    typeof WebBrowser.openAuthSessionAsync
  >;
const mockedBuildDeepLink = buildDeepLink as jest.MockedFunction<
  typeof buildDeepLink
>;
const mockedToast = jest.requireMock('react-native-toast-message').default as {
  show: jest.Mock;
  hide: jest.Mock;
};

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

describe('useStripeConnectOnboarding', () => {
  beforeEach(() => {
    mockedOpenAuthSession.mockReset();
    mockedOpenAuthSession.mockResolvedValue({
      type: 'success',
      url: 'yeridenext-dev://stripe-return',
    });
    mockedBuildDeepLink.mockReset();
    mockedBuildDeepLink.mockImplementation(
      (path: string) => `yeridenext-dev://${path}`,
    );
    mockedToast.show.mockClear();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('happy path: no_account → enabled fires status-flip Toast', async () => {
    const setup = await setupDriver({ stripeAccountId: null });
    // Pre-seed the Connect account that the fake's createConnectAccount
    // will return; then seed the link + retrieve flags.
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

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      const flags = await result.current.start({ previouslyEnabled: false });
      expect(flags).toEqual({ chargesEnabled: true, payoutsEnabled: true });
    });

    expect(mockedOpenAuthSession).toHaveBeenCalledTimes(1);
    expect(mockedOpenAuthSession).toHaveBeenCalledWith(
      'https://connect.stripe.com/setup/abc',
      'yeridenext-dev://stripe-return',
    );
    // Stripe gets HTTPS URLs (custom schemes rejected by the API).
    expect(setup.stripeServer.spies.createAccountLinkCalls[0]).toEqual({
      accountId: aid,
      refreshUrl: 'https://yeride.com/stripe-return',
      returnUrl: 'https://yeride.com/stripe-return',
    });
    expect(mockedToast.show).toHaveBeenCalledWith({
      type: 'success',
      text1: "You're set up to receive payouts.",
    });
    expect(setup.stripeServer.spies.createConnectCalls).toHaveLength(1);
    expect(setup.stripeServer.spies.createAccountLinkCalls).toHaveLength(1);
    expect(setup.stripeServer.spies.retrieveAccountCalls).toHaveLength(1);
  });

  it('cancel still triggers RefreshConnectAccountStatus', async () => {
    const setup = await setupDriver({
      stripeAccountId: unwrap(StripeAccountId.create(SEEDED_AID)),
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    setup.stripeServer.seedConnectAccount({
      accountId: aid,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    setup.stripeServer.seedAccountLink({
      accountId: aid,
      url: 'https://connect.stripe.com/setup/abc',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    });
    mockedOpenAuthSession.mockResolvedValue({ type: 'cancel' } as never);

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      const flags = await result.current.start({ previouslyEnabled: false });
      expect(flags).toEqual({ chargesEnabled: false, payoutsEnabled: false });
    });

    // Refresh ran even though the user canceled the browser session.
    expect(setup.stripeServer.spies.retrieveAccountCalls).toHaveLength(1);
    // No flip into enabled — no Toast.
    expect(mockedToast.show).not.toHaveBeenCalled();
  });

  it('dismiss triggers RefreshConnectAccountStatus (no HTTPS→deep-link bridge)', async () => {
    // Without a server-side bridge from the HTTPS return URL to the
    // app's deep-link scheme, `WebBrowser.openAuthSessionAsync` cannot
    // auto-close — drivers manually dismiss after Stripe completes.
    // Dismiss is therefore the only signal we get and must refresh.
    const setup = await setupDriver({
      stripeAccountId: unwrap(StripeAccountId.create(SEEDED_AID)),
      chargesEnabled: false,
      payoutsEnabled: false,
    });
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
    mockedOpenAuthSession.mockResolvedValue({ type: 'dismiss' } as never);

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      const flags = await result.current.start({ previouslyEnabled: false });
      expect(flags).toEqual({ chargesEnabled: true, payoutsEnabled: true });
    });

    // Refresh ran post-dismiss and picked up the now-enabled status,
    // so the status-flip Toast fires too.
    expect(setup.stripeServer.spies.retrieveAccountCalls).toHaveLength(1);
    expect(mockedToast.show).toHaveBeenCalledWith({
      type: 'success',
      text1: "You're set up to receive payouts.",
    });
  });

  it('does NOT fire Toast when previouslyEnabled was already true', async () => {
    const setup = await setupDriver({
      stripeAccountId: unwrap(StripeAccountId.create(SEEDED_AID)),
      chargesEnabled: true,
      payoutsEnabled: true,
    });
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

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      await result.current.start({ previouslyEnabled: true });
    });

    expect(mockedToast.show).not.toHaveBeenCalled();
  });

  it('unconfigured deep-link scheme short-circuits with error: unconfigured', async () => {
    const setup = await setupDriver({ stripeAccountId: null });
    mockedBuildDeepLink.mockReturnValue(null);

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      const r = await result.current.start();
      expect(r).toBeNull();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('unconfigured');
    });
    // Nothing reached Stripe.
    expect(setup.stripeServer.spies.createConnectCalls).toHaveLength(0);
    expect(mockedOpenAuthSession).not.toHaveBeenCalled();
  });

  it('EnsureStripeConnectAccount NetworkError surfaces as error: network', async () => {
    const setup = await setupDriver({ stripeAccountId: null });
    setup.stripeServer.failNext({
      method: 'createConnectAccount',
      error: new NetworkError({ code: 'fake', message: 'boom' }),
    });

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      const r = await result.current.start();
      expect(r).toBeNull();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('network');
    });
    expect(mockedOpenAuthSession).not.toHaveBeenCalled();
  });

  it('CreateConnectOnboardingLink NetworkError surfaces as error: network', async () => {
    const setup = await setupDriver({
      stripeAccountId: unwrap(StripeAccountId.create(SEEDED_AID)),
    });
    const aid = unwrap(StripeAccountId.create(SEEDED_AID));
    setup.stripeServer.seedConnectAccount({
      accountId: aid,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    setup.stripeServer.failNext({
      method: 'createAccountLink',
      error: new NetworkError({ code: 'fake', message: 'boom' }),
    });

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    await act(async () => {
      const r = await result.current.start();
      expect(r).toBeNull();
    });

    await waitFor(() => {
      expect(result.current.error).toBe('network');
    });
    expect(mockedOpenAuthSession).not.toHaveBeenCalled();
  });

  it('isOnboarding true while running', async () => {
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
    // Hold the browser promise so we can observe `isOnboarding === true`.
    let resolveBrowser: (
      value: WebBrowser.WebBrowserAuthSessionResult,
    ) => void = () => undefined;
    mockedOpenAuthSession.mockReturnValue(
      new Promise<WebBrowser.WebBrowserAuthSessionResult>((resolve) => {
        resolveBrowser = resolve;
      }),
    );

    const { result } = renderHook(() => useStripeConnectOnboarding(), {
      wrapper: withTestContainer(setup),
    });

    let pending: Promise<unknown> | null = null;
    await act(async () => {
      pending = result.current.start({ previouslyEnabled: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isOnboarding).toBe(true);
    });

    await act(async () => {
      resolveBrowser({
        type: 'success',
        url: 'yeridenext-dev://stripe-return',
      });
      await pending;
    });

    expect(result.current.isOnboarding).toBe(false);
  });
});
