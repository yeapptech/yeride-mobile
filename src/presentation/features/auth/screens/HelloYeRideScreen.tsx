import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useUseCases } from '@presentation/di';

/**
 * Phase 0 placeholder screen. No longer mounted by any navigator (Phase 1
 * turn 2 introduced real LogIn / Register / etc. screens). Kept around
 * dormant until a follow-up cleanup PR can delete it; tests still exercise
 * the use-case wiring as a smoke check.
 */
export function HelloYeRideScreen() {
  const { greetUser } = useUseCases();
  const [name, setName] = useState('YeRide');
  const [output, setOutput] = useState<{ greeting: string; error?: string }>({
    greeting: '',
  });

  const onPress = (): void => {
    const result = greetUser.execute({ name });
    if (result.ok) {
      setOutput({ greeting: result.value.greeting });
    } else {
      setOutput({ greeting: '', error: result.error.message });
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-3xl font-bold text-foreground mb-2">
        YeRide Next
      </Text>
      <Text className="text-base text-muted-foreground mb-8">
        Phase 0 smoke test
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        className="w-full border border-border rounded-lg px-4 py-3 mb-4 text-foreground"
        autoCorrect={false}
      />

      <Pressable
        onPress={onPress}
        className="bg-primary rounded-lg px-6 py-3 mb-6 active:opacity-70"
      >
        <Text className="text-primary-foreground font-semibold">Greet</Text>
      </Pressable>

      {output.greeting !== '' && (
        <Text className="text-xl text-success">{output.greeting}</Text>
      )}
      {output.error !== undefined && (
        <Text className="text-base text-error">{output.error}</Text>
      )}
    </View>
  );
}
