import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@presentation/components/ui/Button';
import type { VerifyEmailStackScreenProps } from '@presentation/navigation/types';

import { useEmailVerificationViewModel } from '../view-models/useEmailVerificationViewModel';

export function EmailVerificationScreen(
  _props: VerifyEmailStackScreenProps<'EmailVerification'>,
) {
  const { verified, resend, resending, error, signOut } =
    useEmailVerificationViewModel();

  return (
    <SafeAreaView className="flex-1 bg-background px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="text-3xl font-bold text-foreground mb-4 text-center">
          Verify your email
        </Text>
        <Text className="text-base text-muted-foreground mb-8 text-center">
          We sent a verification link to your inbox. Tap it to continue.
        </Text>

        {verified ? (
          <View className="items-center mb-6">
            <Text className="text-success text-base mb-2">
              ✓ Email verified
            </Text>
            <Text className="text-muted-foreground text-sm text-center">
              You'll be signed in automatically in a moment…
            </Text>
            <ActivityIndicator className="mt-4" size="small" />
          </View>
        ) : (
          <View className="items-center mb-6">
            <ActivityIndicator size="small" />
            <Text className="text-muted-foreground text-xs mt-2">
              Waiting for verification…
            </Text>
          </View>
        )}

        {error !== null && (
          <Text className="mb-4 text-error text-sm">{error}</Text>
        )}

        <Button
          label={resending ? 'Resending…' : 'Resend email'}
          onPress={() => {
            void resend();
          }}
          disabled={resending}
          className="mb-4"
        />

        <Pressable
          onPress={() => {
            void signOut();
          }}
        >
          <Text className="text-info text-sm">Use a different account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
