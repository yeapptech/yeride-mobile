import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

/**
 * Soft-ask sheet for the OS notification-permission prompt. Shown
 * BEFORE the OS dialog so the user understands what they're being
 * asked to allow, and so a tap on "Not now" doesn't burn the OS
 * one-shot prompt budget (iOS won't re-show the prompt once denied).
 *
 * Mounted at AppContent. Visibility is computed there based on:
 *   - User is authenticated AND registration is complete (no point
 *     prompting before the user even has a Stripe customer / vehicle)
 *   - `useNotificationPermissionStatus()` is `'undetermined'`
 *   - `useNotificationSoftDismissedAt()` is null (user hasn't tapped
 *     "Not now" this session)
 *
 * The sheet itself is purely presentational. Its callbacks come from
 * AppContent: `onEnable` calls `usePushTokenRegistration().promptForPermission`
 * and `onDismiss` calls `useNotificationPermissionUiStore.setSoftDismissed(Date.now())`.
 */

interface NotificationPermissionSheetProps {
  readonly visible: boolean;
  /** True while the OS prompt is in flight (prevents double-tap on Enable). */
  readonly isSubmitting?: boolean;
  /** Tap handler for the primary CTA. Triggers the OS permission prompt. */
  readonly onEnable: () => void;
  /** Tap handler for the secondary CTA + backdrop tap + Android back. */
  readonly onDismiss: () => void;
}

export function NotificationPermissionSheet({
  visible,
  isSubmitting,
  onEnable,
  onDismiss,
}: NotificationPermissionSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Required under Android 15 edge-to-edge — without these, the
      // backdrop doesn't extend under the system bars (legacy
      // CLAUDE.md note carried into the rewrite).
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        className="flex-1 bg-foreground/40"
      >
        {/* Inner card absorbs touches so a tap on the card doesn't
            bubble to the outer dismiss Pressable. Mirror of the
            CancelReasonSheet pattern. */}
        <Pressable
          className="mt-auto rounded-t-3xl bg-card p-5"
          onPress={() => undefined}
          testID="notification-permission-sheet"
        >
          <View className="mb-3 self-center h-1 w-12 rounded-full bg-border" />
          <Text className="mb-2 text-xl font-semibold text-foreground">
            Stay updated on your rides
          </Text>
          <Text className="mb-5 text-sm leading-5 text-muted-foreground">
            Allow notifications so you can hear when your driver is on the way,
            when they arrive, and when your trip is complete. You can change
            this anytime in Settings.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enable notifications"
            onPress={isSubmitting ? undefined : onEnable}
            disabled={isSubmitting}
            className={`mb-3 items-center rounded-xl px-4 py-3 ${
              isSubmitting ? 'bg-primary/60' : 'bg-primary'
            }`}
            testID="notification-permission-enable"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text className="text-base font-semibold text-primary-foreground">
                Enable notifications
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Not now"
            onPress={onDismiss}
            className="items-center rounded-xl px-4 py-3"
            testID="notification-permission-dismiss"
          >
            <Text className="text-base font-medium text-muted-foreground">
              Not now
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
