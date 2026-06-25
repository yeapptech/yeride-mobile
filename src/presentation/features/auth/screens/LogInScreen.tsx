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

import { useLogInViewModel } from '../view-models/useLogInViewModel';

export function LogInScreen(_props: AuthStackScreenProps<'LogIn'>) {
  const { submit, submitting, error, goToRegister, goToForgotPassword } =
    useLogInViewModel();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = () => {
    void submit({ email, password });
  };

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
            Welcome back
          </Text>
          <Text className="text-base text-muted-foreground mb-8">
            Sign in to your YeRide account.
          </Text>

          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            testID="login-email-input"
          />

          <FormField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            secureTextEntry
            textContentType="password"
            testID="login-password-input"
          />

          {error !== null && (
            <Text className="mb-4 text-error text-sm">{error}</Text>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            className="bg-primary rounded-2xl px-6 py-4 mb-4 active:opacity-70 disabled:opacity-50"
          >
            <View className="flex-row items-center justify-center">
              {submitting && (
                <ActivityIndicator size="small" color="#000" className="mr-2" />
              )}
              <Text className="text-primary-foreground font-semibold text-base">
                Sign in
              </Text>
            </View>
          </Pressable>

          <Pressable onPress={goToForgotPassword} className="mb-6 self-center">
            <Text className="text-info text-sm">Forgot password?</Text>
          </Pressable>

          <View className="flex-row justify-center">
            <Text className="text-muted-foreground text-sm">
              No account yet?{' '}
            </Text>
            <Pressable onPress={goToRegister}>
              <Text className="text-info text-sm font-semibold">Register</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
