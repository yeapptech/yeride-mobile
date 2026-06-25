import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField } from '@presentation/components/form/FormField';
import { Button } from '@presentation/components/ui/Button';
import type { AuthStackScreenProps } from '@presentation/navigation/types';

import { useForgotPasswordViewModel } from '../view-models/useForgotPasswordViewModel';

export function ForgotPasswordScreen(
  _props: AuthStackScreenProps<'ForgotPassword'>,
) {
  const { submit, submitting, error, sent, goBack } =
    useForgotPasswordViewModel();
  const [email, setEmail] = useState('');

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-3xl font-bold text-foreground mb-2">
            Reset password
          </Text>
          <Text className="text-base text-muted-foreground mb-8">
            We'll email you a link to choose a new one.
          </Text>

          {sent ? (
            <View>
              <Text className="text-success text-base mb-2">✓ Email sent</Text>
              <Text className="text-muted-foreground text-sm mb-8">
                Check your inbox at {email} and follow the link to set a new
                password. The email may take a minute to arrive.
              </Text>
              <Button
                label="Back to sign in"
                onPress={goBack}
                className="self-start"
              />
            </View>
          ) : (
            <>
              <FormField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                textContentType="emailAddress"
              />

              {error !== null && (
                <Text className="mb-4 text-error text-sm">{error}</Text>
              )}

              <Button
                label="Send reset link"
                onPress={() => {
                  void submit(email);
                }}
                loading={submitting}
                className="mb-4"
              />

              <Pressable onPress={goBack} className="self-center">
                <Text className="text-info text-sm">Back to sign in</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
