import { ActivityIndicator, Pressable, Text } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  /** 'primary' = cab-yellow fill; 'secondary' = bordered card. Default 'primary'. */
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  /** Show a spinner + block presses while an action is in flight. */
  readonly loading?: boolean;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
  /** Extra layout classes appended to the button (e.g. 'flex-1', 'mt-4'). */
  readonly className?: string;
}

/**
 * Shared action button in the YeRide design language: rounded-2xl, py-4,
 * extra-bold label, cab-yellow `primary` / bordered-card `secondary`, muted
 * when disabled, and a brand-tinted spinner when `loading`. Centralizes the
 * primary-CTA styling that was previously inlined per screen so every call
 * site stays consistent.
 *
 * Spinner colors are inlined hex (native `ActivityIndicator` can't read
 * Tailwind tokens): #3a2705 = --primary-foreground on gold, #644117 =
 * --brand-deep on the card surface.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  testID,
  accessibilityLabel,
  className = '',
}: ButtonProps) {
  const blocked = disabled || loading;
  // `loading` keeps the variant fill (busy state); only a true disable mutes it.
  const showMuted = disabled && !loading;
  const surface = showMuted
    ? 'bg-muted'
    : variant === 'primary'
      ? 'bg-primary'
      : 'border border-border bg-card';
  const textTone = showMuted
    ? 'text-muted-foreground'
    : variant === 'primary'
      ? 'text-primary-foreground'
      : 'text-foreground';
  const spinnerColor = variant === 'primary' ? '#3a2705' : '#644117';

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      className={`items-center justify-center rounded-2xl px-4 py-4 ${surface} ${className}`}
      {...(testID !== undefined ? { testID } : {})}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <Text className={`text-base font-extrabold ${textTone}`}>{label}</Text>
      )}
    </Pressable>
  );
}
