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

import type { Role } from '@domain/entities/Role';
import { FormField } from '@presentation/components/form/FormField';
import type { AuthStackScreenProps } from '@presentation/navigation/types';

import { useRegisterViewModel } from '../view-models/useRegisterViewModel';

export function RegisterScreen(_props: AuthStackScreenProps<'Register'>) {
  const { submit, submitting, error, goToLogIn } = useRegisterViewModel();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('rider');

  const onSubmit = () => {
    void submit({ firstName, lastName, email, phone, password, role });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-6"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-3xl font-bold text-foreground mb-2">
            Create your account
          </Text>
          <Text className="text-base text-muted-foreground mb-6">
            We'll send a verification link to your email.
          </Text>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <FormField
                label="First name"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                textContentType="givenName"
              />
            </View>
            <View className="flex-1">
              <FormField
                label="Last name"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                textContentType="familyName"
              />
            </View>
          </View>

          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          <FormField
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="+14155550123"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            helper="Include your country code, starting with +"
          />

          <FormField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            secureTextEntry
            textContentType="newPassword"
          />

          <Text className="mb-2 text-sm font-medium text-foreground">
            I want to:
          </Text>
          <View className="mb-6 flex-row gap-3">
            <RoleOption
              label="Ride"
              selected={role === 'rider'}
              onPress={() => {
                setRole('rider');
              }}
            />
            <RoleOption
              label="Drive"
              selected={role === 'driver'}
              onPress={() => {
                setRole('driver');
              }}
            />
          </View>

          {error !== null && (
            <Text className="mb-4 text-error text-sm">{error}</Text>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            className="bg-primary rounded-2xl px-6 py-4 mb-6 active:opacity-70 disabled:opacity-50"
          >
            <View className="flex-row items-center justify-center">
              {submitting && (
                <ActivityIndicator size="small" color="#000" className="mr-2" />
              )}
              <Text className="text-primary-foreground font-semibold text-base">
                Create account
              </Text>
            </View>
          </Pressable>

          <View className="flex-row justify-center">
            <Text className="text-muted-foreground text-sm">
              Already have an account?{' '}
            </Text>
            <Pressable onPress={goToLogIn}>
              <Text className="text-info text-sm font-semibold">Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 rounded-lg border px-4 py-3 ${
        selected ? 'border-primary bg-primary/10' : 'border-border'
      }`}
    >
      <Text
        className={`text-center font-medium ${
          selected ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
