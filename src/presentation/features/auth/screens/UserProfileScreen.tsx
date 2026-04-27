import { useEffect, useState } from 'react';
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
import type { MainStackScreenProps } from '@presentation/navigation/types';

import { useUserProfileViewModel } from '../view-models/useUserProfileViewModel';

export function UserProfileScreen(_props: MainStackScreenProps<'UserProfile'>) {
  const { user, loading, submitting, error, submit, signOut } =
    useUserProfileViewModel();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (user) {
      setFirstName(user.name.first);
      setLastName(user.name.last);
      setPhone(user.phone?.value ?? '');
    }
  }, [user]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-error text-base text-center">
          {error ?? 'Could not load your profile.'}
        </Text>
      </SafeAreaView>
    );
  }

  const onSubmit = () => {
    void submit({ firstName, lastName, phone });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow px-6 py-6"
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar placeholder — Phase 9 */}
          <View className="items-center mb-6">
            <View className="w-24 h-24 rounded-full bg-muted items-center justify-center mb-2">
              <Text className="text-2xl text-muted-foreground">
                {user.name.first.slice(0, 1)}
                {user.name.last.slice(0, 1)}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
              Avatar upload coming in Phase 9
            </Text>
          </View>

          <Text className="text-sm text-muted-foreground mb-1">Email</Text>
          <Text className="text-base text-foreground mb-4">
            {user.email.value}
            {!user.emailVerified && (
              <Text className="text-warning"> (not verified)</Text>
            )}
          </Text>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <FormField
                label="First name"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
              />
            </View>
            <View className="flex-1">
              <FormField
                label="Last name"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
              />
            </View>
          </View>

          <FormField
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="+14155550123"
            keyboardType="phone-pad"
            helper="Include your country code, starting with +"
          />

          {error !== null && (
            <Text className="mb-4 text-error text-sm">{error}</Text>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            className="bg-primary rounded-lg px-6 py-3 mb-3 active:opacity-70 disabled:opacity-50"
          >
            <View className="flex-row items-center justify-center">
              {submitting && (
                <ActivityIndicator size="small" color="#000" className="mr-2" />
              )}
              <Text className="text-primary-foreground font-semibold">
                Save changes
              </Text>
            </View>
          </Pressable>

          <View className="mt-8 mb-4 border-t border-border" />

          <Text className="text-sm text-muted-foreground mb-2">
            Saved places
          </Text>
          <Text className="text-xs text-muted-foreground mb-6">
            Saved-places UI lands in Phase 2 alongside ride route planning.
          </Text>

          <Pressable
            onPress={() => {
              void signOut();
            }}
            className="self-center mb-6"
          >
            <Text className="text-error text-sm">Sign out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
