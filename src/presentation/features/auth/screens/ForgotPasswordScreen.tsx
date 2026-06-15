import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField } from '@presentation/components/form/FormField';
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
              <Pressable
                onPress={goBack}
                className="bg-primary rounded-lg px-6 py-3 self-start active:opacity-70"
              >
                <Text className="text-primary-foreground font-semibold">
                  Back to sign in
                </Text>
              </Pressable>
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

              <Pressable
                onPress={() => {
                  void submit(email);
                }}
                disabled={submitting}
                className="bg-primary rounded-lg px-6 py-4 mb-4 active:opacity-70 disabled:opacity-50"
              >
                <View className="flex-row items-center justify-center">
                  {submitting && (
                    <ActivityIndicator
                      size="small"
                      color="#000"
                      className="mr-2"
                    />
                  )}
                  <Text className="text-primary-foreground font-semibold">
                    Send reset link
                  </Text>
                </View>
              </Pressable>

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
