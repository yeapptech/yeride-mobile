import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Toast from 'react-native-toast-message';

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
  // domain `ChatMessage` → `IMessage` once on every snapshot. The
  // projection is pure on `m` (peer name comes off the entity itself
  // via `senderName`), so `userName` doesn't belong in the deps.
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const giftedMessages = useMemo<IMessage[]>(
    () => messages.map((m) => domainToGifted(m)),
    [messages],
  );

  // ── openRideId mirror (narrow effect — Suggestion #4) ─────────────
  // The previous shape mixed openRideId set/clear into the same effect
  // as the subscription, keyed on `[visible, rideId, role, useCases,
  // open, close, markRead]`. Any change to `useCases` (DI container
  // re-render) would teardown → re-up the effect, briefly clearing
  // `openRideId` to null — during which a push handler could miss the
  // suppression match. Splitting it keeps openRideId stable through
  // the entire `visible=true` window for a given rideId regardless of
  // unrelated re-renders.
  useEffect(() => {
    if (!visible) return;
    open(rideId);
    markRead(rideId, new Date());
    return () => {
      // Only clear openRideId if it still matches — legacy parity
      // guard against an open/close race wiping the next-opened ride.
      const current = useChatUiStore.getState().openRideId;
      if (current !== null && String(current) === String(rideId)) {
        close();
      }
    };
  }, [visible, rideId, open, close, markRead]);

  // ── Subscription + per-snapshot markMessagesRead (deduped) ────────
  // `markMessagesRead` fires on initial open AND when the snapshot
  // delivers a NEWER message than the last call. The dedupe matters
  // because every snapshot otherwise triggers a parent-trip-doc write
  // (and a no-op `onTripUpdated` Cloud Function invocation). Tracks
  // the latest-known createdAt in a ref so a snapshot carrying only
  // older messages (re-render with same data) doesn't re-fire.
  const lastMarkReadForCreatedAtMsRef = useRef<number>(0);
  useEffect(() => {
    if (!visible) return;
    // Reset dedupe state on a fresh open / ride switch so the first
    // snapshot always lands a markMessagesRead.
    lastMarkReadForCreatedAtMsRef.current = 0;

    const fireMarkMessagesRead = (label: 'initial' | 'per-snapshot') => {
      void useCases.markMessagesRead.execute({ rideId, role }).then((r) => {
        if (!r.ok) {
          logger.warn(`markMessagesRead (${label}) failed`, {
            code: r.error.code,
          });
        }
      });
    };

    // Best-effort initial markRead — repo write may fail under offline
    // conditions, but the local store mirror already cleared the
    // unread dot. Don't block / surface — just log.
    fireMarkMessagesRead('initial');

    const unsubscribe = useCases.observeChatMessages.execute({
      rideId,
      callback: (next) => {
        setMessages(next);
        // Per-snapshot markRead — only fires when a NEWER message is
        // present than any we've previously acknowledged for this
        // open-window. Without this gate, an unchanged snapshot (e.g.
        // adapter re-emits on re-subscribe, or `setMessages` triggers
        // re-render that doesn't change the head) would burn a
        // Firestore write per delivery.
        const newestMs = next[0]?.createdAt.getTime() ?? 0;
        if (newestMs > lastMarkReadForCreatedAtMsRef.current) {
          lastMarkReadForCreatedAtMsRef.current = newestMs;
          fireMarkMessagesRead('per-snapshot');
          markRead(rideId, new Date());
        }
      },
    });

    return unsubscribe;
  }, [visible, rideId, role, useCases, markRead]);

  // ── Send (Suggestion #3: user-visible toast on failure) ───────────
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
              // Surface a user-visible toast so the message-disappear
              // (gifted-chat optimistically inserted, snapshot will
              // rebuild without it) doesn't read as a silent drop.
              // Validation errors come from the use case's
              // empty/overlong guards — we already filter empty above,
              // so a ValidationError here means an overlong paste;
              // surface the friendlier copy. NetworkError is the
              // common offline path.
              const isValidation =
                r.error.code === 'chat_message_text_too_long' ||
                r.error.code === 'chat_message_empty_text' ||
                r.error.code === 'chat_message_text_not_a_string';
              Toast.show({
                type: 'error',
                text1: isValidation ? 'Message rejected' : 'Message not sent',
                text2: isValidation
                  ? 'That message is too long. Try a shorter one.'
                  : 'Check your connection and try again.',
              });
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
            {/* Android-only second `KeyboardAvoidingView` is a
                gifted-chat layout shim: the outer KAV uses `padding`
                on Android (correct for the SafeAreaView wrap), but
                the bottom-most input row inside gifted-chat
                additionally needs an inert KAV sibling to reserve
                the input bar height under the soft keyboard. Without
                this, the input row collides with the keyboard on
                Android API 30+. Empty children — its only purpose is
                the KAV height-reservation effect. */}
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
 * `senderName` is pulled off the entity, which the mapper sources from
 * the doc's `user.name` field. Empty string fallback when the field
 * is missing on a legacy doc — gifted-chat's avatar then surfaces its
 * default initial.
 */
function domainToGifted(m: ChatMessage): IMessage {
  return {
    _id: String(m.id),
    text: m.text,
    createdAt: m.createdAt,
    user: {
      _id: String(m.senderId),
      name: m.senderName ?? '',
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
