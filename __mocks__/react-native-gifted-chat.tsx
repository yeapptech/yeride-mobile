/**
 * Manual Jest mock for `react-native-gifted-chat`. Auto-discovered by
 * Jest because this file's path matches `<rootDir>/__mocks__/<package>`.
 *
 * The real package mounts a FlatList-based chat thread + an input row
 * with internal hooks that pull `react-native-keyboard-controller`
 * (which itself depends on reanimated worklets). We replace
 * `<GiftedChat/>` with a minimal stub that renders a `<View/>` carrying
 * a deterministic testID, plus a `Pressable` whose tap invokes the
 * captured `onSend` callback with a synthetic message.
 *
 * Lives as a manual mock (not an inline `jest.mock` factory in
 * `jest.setup.ts`) because the NativeWind babel plugin wraps every
 * component referencing `View` in a CSS-interop helper that closes
 * over a file-scope `_ReactNativeCSSInterop` binding. Inline
 * `jest.mock` factories are hoisted above all file-scope bindings,
 * so the factory body would reference an out-of-scope variable. A
 * regular module file binds correctly. Mirrors the
 * `__mocks__/react-native-maps.tsx` and `__mocks__/react-native-svg.tsx`
 * patterns.
 *
 * Per-test usage:
 *
 *   import { GiftedChat } from 'react-native-gifted-chat';
 *   // Render the component, then:
 *   const stub = getByTestId('mock-gifted-chat-send');
 *   fireEvent.press(stub);
 *   // `onSend` is called with [{_id, text, user, createdAt}].
 *
 * The synthetic message text is `'mock-send-text'` — assert against
 * that in send tests.
 */

import React from 'react';
import { Pressable, View } from 'react-native';

export interface IMessage {
  _id: string | number;
  text: string;
  createdAt: Date | number;
  user: { _id: string | number; name?: string; avatar?: string };
}

interface GiftedChatProps {
  messages?: ReadonlyArray<IMessage>;
  onSend?: (messages: IMessage[]) => void;
  user?: { _id: string | number; name?: string };
  showUserAvatar?: boolean;
  renderAvatarOnTop?: boolean;
  keyboardShouldPersistTaps?: string;
}

export function GiftedChat(props: GiftedChatProps) {
  return (
    <View
      testID="mock-gifted-chat"
      accessibilityLabel={`messages-count:${String(props.messages?.length ?? 0)}`}
    >
      <Pressable
        testID="mock-gifted-chat-send"
        onPress={() => {
          const u = props.user ?? { _id: 'test-user' };
          props.onSend?.([
            {
              _id: 'mock-msg',
              text: 'mock-send-text',
              createdAt: new Date(),
              user: u,
            },
          ]);
        }}
      />
    </View>
  );
}
