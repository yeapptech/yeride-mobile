import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GiftedChat, type IMessage } from 'react-native-gifted-chat';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { PersonName } from '@domain/entities/PersonName';
import type { RideId } from '@domain/entities/RideId';
import type { UserId } from '@domain/entities/UserId';
import { useUseCases } from '@presentation/di';
import { useChatUiStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('ChatModal');

/**
 * In-trip chat modal — rider ↔ driver messaging surface.
 *
 * Mounts `<GiftedChat/>` from `react-native-gifted-chat` and wires three
 * use cases:
 *   - `observeChatMessages` drives the message list. The subscription
 *     is created when the modal becomes visible and torn down on close
 *     (synchronous unsubscribe — no `cancelled`-flag dance).
 *   - `sendChatMessage` handles `onSend` — gifted-chat invokes it with
 *     an array of pending messages (usually one).
 *   - `markMessagesRead` fires on mount AND after every observe-emit so
 *     the OTHER party's unread badge clears the moment the recipient
 *     opens the thread. Matches legacy `ChatModal.js:58-60,72-74`.
 *
 * Sets `useChatUiStore.openRideId = rideId` on visibility AND a local
 * `markRead(new Date())` so the unread-dot derivation clears
 * optimistically. Clears `openRideId` on unmount IFF it still matches
 * the current ride id (legacy guard against two fast open/close cycles
 * racing the cleanup — see legacy `ChatModal.js:79`).
 *
 * The `openRideId` selector is read by `AppContent`'s foreground
 * notification handler to suppress `chat_message` banners for the
 * currently-open thread.
 *
 * Modal mounted with `statusBarTranslucent` + `navigationBarTranslucent`
 * (Android 15 edge-to-edge — CLAUDE.md rule). NativeWind semantic
 * tokens — no raw hex. The legacy `#007BFF` close-button color is
 * replaced with `text-primary`.
 *
 * Wire-shape note: the Cloud Function trigger `onMessageCreated`
 * (yeride-functions/handlers/message-created.js) reads `msg.user?.name`
 * for the push title. The view-model passes the local user's
 * `PersonName`; `sendChatMessage` projects `.full` into `user.name` at
 * the wire boundary. Don't strip the name on send.
 */
interface ChatModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly rideId: RideId;
  readonly userId: UserId;
  readonly userName: PersonName;
  readonly role: 'rider' | 'driver';
}

export function ChatModal({
  visible,
  onClose,
  rideId,
  userId,
  userName,
  role,
}: ChatModalProps) {
  const useCases = useUseCases();
  const open = useChatUiStore((s) => s.open);
  const close = useChatUiStore((s) => s.close);
  const markRead = useChatUiStore((s) => s.markRead);

  // gifted-chat consumes its own message shape; the adapter projects
  // domain `ChatMessage` → `IMessage` once on every snapshot.
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const giftedMessages = useMemo<IMessage[]>(
    () => messages.map((m) => domainToGifted(m, userName)),
    [messages, userName],
  );

  // Subscribe / unsubscribe on visibility. The effect deps include
  // `rideId` and the use-case container so a ride switch (rare — modal
  // remounts) wires a fresh subscription. `markMessagesRead` fires
  // both on initial open AND inside the snapshot callback so the
  // OTHER party's badge clears on every new message arrival while the
  // modal is open (legacy parity).
  useEffect(() => {
    if (!visible) return;
    // Set the open-ride signal so the foreground push handler can
    // match against it.
    open(rideId);
    markRead(new Date());

    // Best-effort initial markRead — repo write may fail under
    // offline conditions, but the local store mirror already cleared
    // the unread dot. Don't block / surface — just log.
    void useCases.markMessagesRead.execute({ rideId, role }).then((r) => {
      if (!r.ok) {
        logger.warn('markMessagesRead (initial) failed', {
          code: r.error.code,
        });
      }
    });

    const unsubscribe = useCases.observeChatMessages.execute({
      rideId,
      callback: (next) => {
        setMessages(next);
        // Mark read again on every snapshot — covers the case where a
        // new message arrives while the modal is open. Same as legacy
        // ChatModal.js:72-74.
        void useCases.markMessagesRead.execute({ rideId, role }).then((r) => {
          if (!r.ok) {
            logger.warn('markMessagesRead (per-snapshot) failed', {
              code: r.error.code,
            });
          }
        });
        markRead(new Date());
      },
    });

    return () => {
      unsubscribe();
      // Only clear openRideId if it still matches — legacy parity
      // guard against an open/close race wiping the next-opened ride.
      const current = useChatUiStore.getState().openRideId;
      if (current !== null && String(current) === String(rideId)) {
        close();
      }
    };
  }, [visible, rideId, role, useCases, open, close, markRead]);

  const handleSend = useCallback(
    (sentMessages: IMessage[] = []) => {
      // gifted-chat sends one message per onSend call in practice;
      // iterate defensively in case it ever batches.
      for (const m of sentMessages) {
        if (typeof m.text !== 'string' || m.text.trim().length === 0) continue;
        void useCases.sendChatMessage
          .execute({
            rideId,
            sender: { id: userId, name: userName },
            text: m.text,
          })
          .then((r) => {
            if (!r.ok) {
              logger.warn('sendChatMessage failed', { code: r.error.code });
              // VM-level toast is wired separately; here we only log.
              // gifted-chat already inserted the message optimistically
              // in its own list — when the next snapshot fires (without
              // the failed message), the list rebuilds from server
              // state.
            }
          });
      }
    },
    [useCases, rideId, userId, userName],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? 'padding' : undefined}
        style={styles.modalContainer}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <SafeAreaView
          edges={['top', 'bottom']}
          className="flex-1 overflow-hidden rounded-t-2xl bg-background"
        >
          <View className="flex-1">
            <View
              className="flex-row items-center justify-between border-b border-border px-4 py-3"
              testID="chat-modal-header"
            >
              <Text className="text-base font-semibold text-foreground">
                Chat
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close chat"
                testID="chat-modal-close"
              >
                <Text className="text-sm font-semibold text-primary">
                  Close
                </Text>
              </Pressable>
            </View>
            <GiftedChat
              messages={giftedMessages}
              onSend={handleSend}
              user={{
                _id: String(userId),
                name: userName.full,
              }}
              showUserAvatar
              renderAvatarOnTop
              keyboardShouldPersistTaps="handled"
            />
            {Platform.OS === 'android' && (
              <KeyboardAvoidingView behavior="padding" />
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Project a domain `ChatMessage` to the `IMessage` shape gifted-chat
 * renders. gifted-chat shows messages bottom-up by `createdAt`, so the
 * list arriving from the adapter (already in DESC order) lines up
 * 1:1 with gifted-chat's expectations.
 *
 * `_userName` is the LOCAL viewer's name — used to disambiguate the
 * `_id` self/peer comparison gifted-chat does at render time. We
 * don't try to project the peer's name onto inbound messages here
 * (legacy ChatModal didn't either); gifted-chat's `user.name` is
 * surfaced from the doc's `user.name` field via the wire shape.
 */
function domainToGifted(m: ChatMessage, _userName: PersonName): IMessage {
  return {
    _id: String(m.id),
    text: m.text,
    createdAt: m.createdAt,
    user: {
      _id: String(m.senderId),
      // Name is read off the doc via the wire shape; gifted-chat's
      // peer-row renders use it for the avatar fallback initial. We
      // pass an empty string when projecting from the domain because
      // the entity doesn't carry the sender's display name — that's
      // fine for the rider-side (the rider's own messages get their
      // own name from the `user` prop on `<GiftedChat/>`), and the
      // peer-side falls back to gifted-chat's "Anonymous" default.
      name: '',
    },
  };
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
