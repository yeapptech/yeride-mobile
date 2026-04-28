import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * Shared header for the status views inside RideMonitor's bottom sheet.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Title                                              [icon]   │
 *   │ Subtitle                                                    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The icon slot is optional and right-aligned. Used in turn 3.4a for
 * the cancel button on AwaitingDriverView and the (cancel + chat-stub)
 * pair on DispatchedView.
 *
 * Pressable trailing actions take an `onPress` + accessible label; the
 * header itself has no built-in semantics beyond two text rows so screen
 * readers can announce title + subtitle as a single announcement.
 */
interface BottomSheetHeaderProps {
  readonly title: string;
  /**
   * Optional subtitle. Typed as `string | undefined` (not just optional)
   * so callers can pass a possibly-undefined expression directly under
   * `exactOptionalPropertyTypes`.
   */
  readonly subtitle?: string | undefined;
  /** Optional right-aligned action(s) — typically a row of icon buttons. */
  readonly trailing?: ReactNode | undefined;
}

export function BottomSheetHeader({
  title,
  subtitle,
  trailing,
}: BottomSheetHeaderProps) {
  return (
    <View className="flex-row items-start justify-between px-4 py-3">
      <View className="flex-1 pr-3">
        <Text
          className="text-lg font-semibold text-foreground"
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            className="mt-0.5 text-sm text-muted-foreground"
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {trailing && <View className="flex-row gap-2">{trailing}</View>}
    </View>
  );
}

/**
 * A tiny helper for the common case: a labeled circular icon button on
 * the right of a header. Used by AwaitingDriverView (cancel) and
 * DispatchedView (cancel + chat-stub).
 */
interface HeaderIconButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: 'neutral' | 'destructive' | undefined;
  readonly disabled?: boolean | undefined;
  /** Inner icon glyph or short text — kept minimal in turn 3.4a. */
  readonly children: ReactNode;
  readonly testID?: string | undefined;
}

export function HeaderIconButton({
  label,
  onPress,
  tone = 'neutral',
  disabled,
  children,
  testID,
}: HeaderIconButtonProps) {
  const toneClass = tone === 'destructive' ? 'bg-error/10' : 'bg-muted';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`h-9 min-w-9 items-center justify-center rounded-full px-3 ${toneClass} ${
        disabled ? 'opacity-50' : ''
      }`}
      {...(testID ? { testID } : {})}
    >
      {children}
    </Pressable>
  );
}
