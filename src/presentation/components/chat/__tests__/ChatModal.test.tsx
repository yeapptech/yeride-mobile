import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { PersonName } from '@domain/entities/PersonName';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { useChatUiStore } from '@presentation/stores';
import { InMemoryChatRepository, TestContainerProvider } from '@shared/testing';

import { ChatModal } from '../ChatModal';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const RIDE_ID = unwrap(RideId.create('ride_chatmodal_test_1'));
const USER_ID = unwrap(UserId.create('a'.repeat(28)));
const USER_NAME = unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' }));

function withChatsRepo(chats?: InMemoryChatRepository) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider {...(chats ? { chats } : {})}>
      {children}
    </TestContainerProvider>
  );
}

describe('ChatModal', () => {
  beforeEach(() => {
    useChatUiStore.getState().reset();
  });

  it('does not subscribe / markRead when visible=false', () => {
    const chats = new InMemoryChatRepository();
    const { queryByTestId } = render(
      <ChatModal
        visible={false}
        onClose={() => undefined}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="rider"
      />,
      { wrapper: withChatsRepo(chats) },
    );
    // The visibility-gated useEffect short-circuits on `visible=false`,
    // so no subscription is created and no markRead fires.
    expect(chats.spies.markMessagesRead).toBe(0);
    // @testing-library/react-native does NOT render Modal children when
    // `visible=false` — the inner gifted-chat tree is absent.
    expect(queryByTestId('mock-gifted-chat-send')).toBeNull();
    expect(queryByTestId('chat-modal-close')).toBeNull();
  });

  it('sets useChatUiStore.openRideId on mount when visible=true', async () => {
    const chats = new InMemoryChatRepository();
    render(
      <ChatModal
        visible
        onClose={() => undefined}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="rider"
      />,
      { wrapper: withChatsRepo(chats) },
    );
    await waitFor(() => {
      const openId = useChatUiStore.getState().openRideId;
      expect(openId).not.toBe(null);
      expect(String(openId)).toBe(String(RIDE_ID));
    });
  });

  it('fires markMessagesRead({role}) on initial mount', async () => {
    const chats = new InMemoryChatRepository();
    render(
      <ChatModal
        visible
        onClose={() => undefined}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="rider"
      />,
      { wrapper: withChatsRepo(chats) },
    );
    await waitFor(() => {
      expect(
        chats.getMarkReadCallsFor(RIDE_ID, 'rider'),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('uses the driver role for driver-side mounts', async () => {
    const chats = new InMemoryChatRepository();
    render(
      <ChatModal
        visible
        onClose={() => undefined}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="driver"
      />,
      { wrapper: withChatsRepo(chats) },
    );
    await waitFor(() => {
      expect(
        chats.getMarkReadCallsFor(RIDE_ID, 'driver'),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('sending via the gifted-chat stub invokes sendChatMessage on the repo', async () => {
    const chats = new InMemoryChatRepository();
    const { getByTestId } = render(
      <ChatModal
        visible
        onClose={() => undefined}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="rider"
      />,
      { wrapper: withChatsRepo(chats) },
    );

    // The gifted-chat mock exposes a `Pressable` with testID
    // `mock-gifted-chat-send` that invokes the captured `onSend` with
    // a single message whose text is `'mock-send-text'`.
    fireEvent.press(getByTestId('mock-gifted-chat-send'));

    await waitFor(() => {
      expect(chats.spies.send).toBe(1);
    });
    expect(chats.spies.lastSendArgs?.text).toBe('mock-send-text');
    expect(String(chats.spies.lastSendArgs?.rideId)).toBe(String(RIDE_ID));
  });

  it('close button invokes onClose', () => {
    const chats = new InMemoryChatRepository();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <ChatModal
        visible
        onClose={onClose}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="rider"
      />,
      { wrapper: withChatsRepo(chats) },
    );
    fireEvent.press(getByTestId('chat-modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('re-fires markMessagesRead when a new message arrives in the subscription', async () => {
    const chats = new InMemoryChatRepository();
    render(
      <ChatModal
        visible
        onClose={() => undefined}
        rideId={RIDE_ID}
        userId={USER_ID}
        userName={USER_NAME}
        role="rider"
      />,
      { wrapper: withChatsRepo(chats) },
    );
    // Initial mount → at least one call.
    await waitFor(() => {
      expect(
        chats.getMarkReadCallsFor(RIDE_ID, 'rider'),
      ).toBeGreaterThanOrEqual(1);
    });
    const before = chats.getMarkReadCallsFor(RIDE_ID, 'rider');

    // A peer sends → snapshot emit → markMessagesRead fires again.
    const peerName = unwrap(
      PersonName.create({ first: 'Charles', last: 'Babbage' }),
    );
    await chats.send({
      rideId: RIDE_ID,
      sender: { id: USER_ID, name: peerName },
      text: 'hey',
    });
    await waitFor(() => {
      expect(chats.getMarkReadCallsFor(RIDE_ID, 'rider')).toBeGreaterThan(
        before,
      );
    });
  });
});
