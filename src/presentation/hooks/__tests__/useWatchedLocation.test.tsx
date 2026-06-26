import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useWatchedLocation } from '../useWatchedLocation';

const mockRemove = jest.fn();
const mockWatchCallbacks: Array<
  (reading: {
    coords: { latitude: number; longitude: number; heading?: number | null };
  }) => void
> = [];

jest.mock('expo-location', () => ({
  __esModule: true,
  Accuracy: { Balanced: 3, Lowest: 1, High: 4 },
  watchPositionAsync: jest.fn(async (_opts, cb) => {
    mockWatchCallbacks.push(cb);
    return { remove: mockRemove };
  }),
}));

function emit(
  latitude: number,
  longitude: number,
  heading: number | null = null,
) {
  act(() => {
    mockWatchCallbacks.forEach((cb) =>
      cb({ coords: { latitude, longitude, heading } }),
    );
  });
}

describe('useWatchedLocation', () => {
  beforeEach(() => {
    mockWatchCallbacks.length = 0;
    mockRemove.mockClear();
  });

  it('does NOT start a watch while disabled', () => {
    const { result } = renderHook(() => useWatchedLocation(false));
    expect(mockWatchCallbacks).toHaveLength(0);
    expect(result.current.coordinates).toBeNull();
    expect(result.current.heading).toBeNull();
  });

  it('starts the watch when enabled and updates coordinates + heading from fixes', async () => {
    const { result } = renderHook(() => useWatchedLocation(true));
    await waitFor(() => {
      expect(mockWatchCallbacks.length).toBeGreaterThan(0);
    });

    emit(26.13, -80.27, 90);

    expect(result.current.coordinates?.latitude).toBeCloseTo(26.13);
    expect(result.current.coordinates?.longitude).toBeCloseTo(-80.27);
    expect(result.current.heading).toBe(90);
  });

  it('HOLDS the last heading when a fix reports an invalid heading (−1 / null) but still advances position', async () => {
    const { result } = renderHook(() => useWatchedLocation(true));
    await waitFor(() => {
      expect(mockWatchCallbacks.length).toBeGreaterThan(0);
    });

    emit(26.13, -80.27, 137);
    expect(result.current.heading).toBe(137);

    emit(26.14, -80.28, -1);
    expect(result.current.coordinates?.latitude).toBeCloseTo(26.14); // advances
    expect(result.current.heading).toBe(137); // held
  });

  it('removes the subscription on unmount', async () => {
    const { unmount } = renderHook(() => useWatchedLocation(true));
    await waitFor(() => {
      expect(mockWatchCallbacks.length).toBeGreaterThan(0);
    });
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });

  it('requests High accuracy (not low-power Balanced) so it actively wakes the GPS', async () => {
    renderHook(() => useWatchedLocation(true));
    await waitFor(() => {
      expect(mockWatchCallbacks.length).toBeGreaterThan(0);
    });
    const calls = (Location.watchPositionAsync as jest.Mock).mock.calls;
    const opts = calls[calls.length - 1]?.[0];
    // Balanced never forces the GPS active — on emulator route playback the
    // route points never stream to us and the car marker freezes (only an
    // external high-accuracy consumer like Google Maps turn-by-turn would
    // wake it). High accuracy makes THIS watch the GPS-waker. Lock the value
    // so a refactor can't silently regress to Balanced.
    expect(opts.accuracy).toBe(Location.Accuracy.High);
    expect(opts.timeInterval).toBe(1000);
    expect(opts.distanceInterval).toBe(5);
  });
});
