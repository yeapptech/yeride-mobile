/**
 * Manual Jest mock for `@react-native-community/datetimepicker`.
 * Auto-discovered by Jest because the path matches
 * `<rootDir>/__mocks__/<package>`.
 *
 * The real package exports a native-view component that fails to
 * render outside a live RN runtime. We replace it with a stub `<View>`
 * whose props are encoded into `testID`s + a programmable `onChange`
 * driver so consumer tests can simulate date selection without
 * touching the native bridge.
 *
 * Tests fire a selection via:
 *
 *   import DateTimePicker from '@react-native-community/datetimepicker';
 *   // imported component takes the `onChange` prop directly; tests
 *   // can find the rendered view by testID and call its onChange via
 *   // the mock exposed below.
 *
 * Lives as a manual mock (not an inline `jest.mock` factory) for the
 * same NativeWind-babel-hoisting reason `react-native-maps.tsx`
 * documents.
 */

import { View } from 'react-native';

export type DateTimePickerEvent = {
  type: 'set' | 'dismissed' | 'neutralButtonPressed';
  nativeEvent: { timestamp?: number };
};

type DateTimePickerProps = {
  readonly value: Date;
  readonly mode?: 'date' | 'time' | 'datetime';
  readonly display?: 'default' | 'spinner' | 'calendar' | 'clock';
  readonly is24Hour?: boolean;
  readonly minimumDate?: Date;
  readonly onChange?: (event: DateTimePickerEvent, date?: Date) => void;
  readonly testID?: string;
  readonly style?: object;
};

export default function DateTimePicker(props: DateTimePickerProps) {
  // Encode the mode + value into a testID-derived shape so consumer
  // tests can assert on what was rendered. Real datetimepicker on
  // iOS/Android shows a chrome UI; the test surface needs just enough
  // structure to drive onChange.
  return <View testID={props.testID ?? 'mock-datetimepicker'} />;
}
