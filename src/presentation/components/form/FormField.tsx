import { Text, TextInput, View, type TextInputProps } from 'react-native';

interface FormFieldProps extends Omit<
  TextInputProps,
  'value' | 'onChangeText'
> {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  error?: string | undefined;
  helper?: string | undefined;
}

/**
 * Minimal labeled text input with error / helper text. Used by the auth
 * screens so each form doesn't reinvent error display.
 *
 * Styling stays in the design tokens from `global.css` — `bg-background`,
 * `text-foreground`, `border-error`, etc. — so dark mode comes for free.
 */
export function FormField({
  label,
  value,
  onChangeText,
  error,
  helper,
  ...rest
}: FormFieldProps) {
  return (
    <View className="mb-4 w-full">
      <Text className="mb-1 text-sm font-medium text-foreground">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        autoCapitalize="none"
        className={`w-full rounded-lg border px-4 py-3 text-foreground ${
          error ? 'border-error' : 'border-border'
        }`}
        placeholderTextColor="#9ca3af"
        {...rest}
      />
      {error !== undefined && error.length > 0 && (
        <Text className="mt-1 text-xs text-error">{error}</Text>
      )}
      {error === undefined && helper !== undefined && helper.length > 0 && (
        <Text className="mt-1 text-xs text-muted-foreground">{helper}</Text>
      )}
    </View>
  );
}
