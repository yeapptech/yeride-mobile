/**
 * Phase 10 turn 8 — foreground push-banner suppression.
 *
 * The hook calls `Notifications.setNotificationHandler` once on
 * mount. We capture the handler via the jest mock and exercise it
 * directly with synthetic notification objects, asserting:
 *   - chat_message + matching openRideId → suppress (all flags false)
 *   - chat_message + non-matching openRideId → show
 *   - non-chat notification → show
 *   - chat_message + no chat open → show
 */
type HandleNotification = (notification: {
  request: { content: { data: Record<string, unknown> | null | undefined } };
}) => Promise<{
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}>;

const mockSetNotificationHandler = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (cfg: { handleNotification: HandleNotification }) => {
    mockSetNotificationHandler(cfg);
  },
}));

import { renderHook } from '@testing-library/react-native';

import { RideId } from '@domain/entities/RideId';
import { useChatUiStore } from '@presentation/stores';

import { useForegroundNotificationHandler } from '../useForegroundNotificationHandler';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const TRIP_ID = 'ride_chat_test_42';
const RIDE_ID = unwrap(RideId.create(TRIP_ID));

function getRegisteredHandler(): HandleNotification {
  expect(mockSetNotificationHandler).toHaveBeenCalled();
  const cfg = mockSetNotificationHandler.mock.calls[0]?.[0] as {
    handleNotification: HandleNotification;
  };
  return cfg.handleNotification;
}

function makeNotif(data: Record<string, unknown> | null): {
  request: { content: { data: Record<string, unknown> | null | undefined } };
} {
  return { request: { content: { data } } };
}

describe('useForegroundNotificationHandler', () => {
  beforeEach(() => {
    mockSetNotificationHandler.mockClear();
    useChatUiStore.getState().reset();
  });

  it('registers a notification handler on mount', () => {
    renderHook(() => useForegroundNotificationHandler());
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('suppresses chat_message banner when openRideId matches the payload tripId', async () => {
    renderHook(() => useForegroundNotificationHandler());
    useChatUiStore.getState().open(RIDE_ID);

    const handler = getRegisteredHandler();
    const r = await handler(
      makeNotif({ type: 'chat_message', tripId: TRIP_ID }),
    );

    expect(r.shouldShowBanner).toBe(false);
    expect(r.shouldShowList).toBe(false);
    expect(r.shouldPlaySound).toBe(false);
    expect(r.shouldSetBadge).toBe(false);
  });

  it('shows chat_message banner when openRideId does NOT match the payload tripId', async () => {
    renderHook(() => useForegroundNotificationHandler());
    useChatUiStore.getState().open(RIDE_ID);

    const handler = getRegisteredHandler();
    const r = await handler(
      makeNotif({ type: 'chat_message', tripId: 'a_different_trip' }),
    );

    expect(r.shouldShowBanner).toBe(true);
    expect(r.shouldShowList).toBe(true);
    expect(r.shouldPlaySound).toBe(true);
    expect(r.shouldSetBadge).toBe(false);
  });

  it('shows chat_message banner when no chat is open', async () => {
    renderHook(() => useForegroundNotificationHandler());
    // openRideId starts as null after reset.

    const handler = getRegisteredHandler();
    const r = await handler(
      makeNotif({ type: 'chat_message', tripId: TRIP_ID }),
    );

    expect(r.shouldShowBanner).toBe(true);
    expect(r.shouldShowList).toBe(true);
  });

  it('shows non-chat notifications regardless of openRideId', async () => {
    renderHook(() => useForegroundNotificationHandler());
    useChatUiStore.getState().open(RIDE_ID);

    const handler = getRegisteredHandler();
    const r = await handler(
      makeNotif({ type: 'trip_dispatched', tripId: TRIP_ID }),
    );

    expect(r.shouldShowBanner).toBe(true);
    expect(r.shouldShowList).toBe(true);
  });

  it('shows the banner when data is missing or malformed', async () => {
    renderHook(() => useForegroundNotificationHandler());

    const handler = getRegisteredHandler();
    const r1 = await handler(makeNotif(null));
    expect(r1.shouldShowBanner).toBe(true);
    const r2 = await handler(makeNotif({ type: 'chat_message' })); // no tripId
    expect(r2.shouldShowBanner).toBe(true);
  });
});
