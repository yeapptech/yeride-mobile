import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
  FakeCrashReportingService,
  TestContainerProvider,
} from '@shared/testing';

import DriverActivityPlaceholderScreen from '../DriverActivityPlaceholderScreen';

/**
 * Phase 9 turn 3 sub-turn 3c — render smoke for the driver Activity
 * placeholder. Confirms the legacy "coming soon" copy still renders
 * AND that `<DevToolsSection/>` is mounted underneath under `__DEV__`.
 *
 * Functional coverage of the dev-tools section itself lives in
 * `src/presentation/components/dev/__tests__/DevToolsSection.test.tsx`.
 */

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: () => null,
}));

function withProvider(children: ReactNode) {
  return (
    <TestContainerProvider crashReporting={new FakeCrashReportingService()}>
      {children}
    </TestContainerProvider>
  );
}

describe('DriverActivityPlaceholderScreen', () => {
  it('renders the placeholder copy and the DevToolsSection under __DEV__', () => {
    const { getByText, getByTestId } = render(
      withProvider(<DriverActivityPlaceholderScreen />),
    );
    expect(getByText('Activity')).toBeTruthy();
    expect(getByText(/Phase 5/i)).toBeTruthy();
    expect(getByTestId('dev-tools-section')).toBeTruthy();
  });
});
