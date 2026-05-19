import { act, renderHook, waitFor } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import type { TripPayment } from '@domain/entities/TripPayment';
import { UserId } from '@domain/entities/UserId';

import {
  useGenerateReceiptPdfViewModel,
  type ReceiptPdfState,
} from '../useGenerateReceiptPdfViewModel';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number): Money {
  return unwrap(Money.fromMajor(major, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('ridepdfvmxxxxxxxxxxxa'));

function makeCompletedRide(): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('rider12345678901234567890123')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('rider@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155550123')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const tier = unwrap(
    RideServiceSnapshot.create({
      id: unwrap(RideServiceId.create('economy')),
      name: 'Economy',
      baseFare: usd(2.5),
      minimumFare: usd(5),
      cancelationFee: usd(2),
      costPerKm: usd(1.25),
      costPerMinute: usd(0.2),
      seatCapacity: 4,
    }),
  );
  return unwrap(
    Ride.fromProps({
      id: RIDE_ID,
      status: 'completed',
      passenger,
      driver: null,
      rideService: tier,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'Bayfront Park',
          placeName: 'Bayfront Park',
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: '1 Las Olas Blvd',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date('2026-04-28T15:30:00Z'),
      pickupTiming: {
        startedAt: new Date('2026-04-28T15:30:00Z'),
        completedAt: new Date('2026-04-28T15:35:00Z'),
        odometerMeters: 0,
        elapsedSeconds: 300,
      },
      dropoffTiming: {
        startedAt: new Date('2026-04-28T15:35:00Z'),
        completedAt: new Date('2026-04-28T16:00:00Z'),
        odometerMeters: 10_000,
      },
      cancellation: null,
      routePreference: null,
      schedulePickupAt: null,
    }),
  );
}

const FARE: TripPayment = {
  id: 'pay-fare',
  type: 'fare',
  amount: usd(18),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T16:00:30Z'),
  paymentMethodId: null,
};

const baseArgs = () => ({
  ride: makeCompletedRide(),
  farePayment: FARE,
  tipPayment: null,
  refundPayment: null,
  fareTotal: usd(18),
  paymentBrand: null,
  paymentLast4: null,
});

function assertKind<K extends ReceiptPdfState['kind']>(
  state: ReceiptPdfState,
  kind: K,
): asserts state is Extract<ReceiptPdfState, { kind: K }> {
  if (state.kind !== kind) {
    throw new Error(`expected state.kind === '${kind}', got '${state.kind}'`);
  }
}

const printToFileAsyncMock = Print.printToFileAsync as jest.Mock;
const isAvailableAsyncMock = Sharing.isAvailableAsync as jest.Mock;
const shareAsyncMock = Sharing.shareAsync as jest.Mock;
const FileMock = File as unknown as jest.Mock;

describe('useGenerateReceiptPdfViewModel — Phase 9 turn 16', () => {
  beforeEach(() => {
    printToFileAsyncMock.mockReset();
    printToFileAsyncMock.mockResolvedValue({
      uri: 'file:///tmp/receipt-test.pdf',
      numberOfPages: 1,
    });
    isAvailableAsyncMock.mockReset();
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockReset();
    shareAsyncMock.mockResolvedValue(undefined);
    FileMock.mockClear();
  });

  it('starts in idle and exposes onShare', () => {
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );
    assertKind(result.current.state, 'idle');
    expect(typeof result.current.state.onShare).toBe('function');
  });

  it('happy path: idle → generating → sharing → shared and cleans up', async () => {
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );
    assertKind(result.current.state, 'idle');

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });

    // Synchronously after onShare(), phase is generating.
    assertKind(result.current.state, 'generating');

    await waitFor(() => {
      expect(result.current.state.kind).toBe('shared');
    });
    assertKind(result.current.state, 'shared');

    expect(printToFileAsyncMock).toHaveBeenCalledTimes(1);
    // The HTML payload must be a non-trivial string.
    const callArg = printToFileAsyncMock.mock.calls[0]?.[0] as { html: string };
    expect(callArg.html).toContain('YeRide');
    expect(callArg.html).toContain('Trip fare');

    expect(isAvailableAsyncMock).toHaveBeenCalledTimes(1);
    expect(shareAsyncMock).toHaveBeenCalledTimes(1);
    expect(shareAsyncMock.mock.calls[0]?.[0]).toBe(
      'file:///tmp/receipt-test.pdf',
    );

    // File cleanup: a File instance was constructed for the temp uri
    // and its `.delete()` was called.
    expect(FileMock).toHaveBeenCalled();
    const lastInstance = FileMock.mock.instances[
      FileMock.mock.instances.length - 1
    ] as { delete: jest.Mock };
    expect(lastInstance.delete).toHaveBeenCalledTimes(1);
  });

  it('error → pdf_generation_failed when printToFileAsync throws', async () => {
    printToFileAsyncMock.mockRejectedValueOnce(new Error('Print SDK exploded'));
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    assertKind(result.current.state, 'error');
    expect(result.current.state.error.kind).toBe('pdf_generation_failed');
    expect(result.current.state.error.message).toBe('Print SDK exploded');

    // No share was attempted, no file was constructed (no temp file
    // existed to clean up).
    expect(shareAsyncMock).not.toHaveBeenCalled();
    expect(FileMock).not.toHaveBeenCalled();
  });

  it('error → sharing_unavailable when Sharing.isAvailableAsync returns false', async () => {
    isAvailableAsyncMock.mockResolvedValueOnce(false);
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    assertKind(result.current.state, 'error');
    expect(result.current.state.error.kind).toBe('sharing_unavailable');
    expect(result.current.state.error.message).toMatch(/email/i);

    // Print succeeded, so a temp file was generated and must have
    // been cleaned up.
    expect(printToFileAsyncMock).toHaveBeenCalledTimes(1);
    expect(shareAsyncMock).not.toHaveBeenCalled();
    expect(FileMock).toHaveBeenCalledTimes(1);
    const inst = FileMock.mock.instances[0] as { delete: jest.Mock };
    expect(inst.delete).toHaveBeenCalledTimes(1);
  });

  it('error → unknown when Sharing.shareAsync throws', async () => {
    shareAsyncMock.mockRejectedValueOnce(new Error('User cancelled share'));
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    assertKind(result.current.state, 'error');
    expect(result.current.state.error.kind).toBe('unknown');
    expect(result.current.state.error.message).toBe('User cancelled share');

    // The temp file was generated before shareAsync threw, so cleanup
    // still fired.
    expect(FileMock).toHaveBeenCalledTimes(1);
    const inst = FileMock.mock.instances[0] as { delete: jest.Mock };
    expect(inst.delete).toHaveBeenCalledTimes(1);
  });

  it('cleanup error is swallowed at LOG.warn (does not surface as user-facing error)', async () => {
    // Make File.delete throw; the success path should still flip to
    // 'shared' (cleanup is best-effort).
    FileMock.mockImplementationOnce(function (
      this: { uri: string; delete: jest.Mock },
      ...uris: unknown[]
    ) {
      this.uri = String(uris[uris.length - 1] ?? '');
      this.delete = jest.fn(() => {
        throw new Error('Disk full');
      });
    });
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('shared');
    });
    // Confirm we ended up shared, NOT in an error arm.
    assertKind(result.current.state, 'shared');
  });

  it('idempotent guard: second onShare() while generating is a no-op', async () => {
    // Hold printToFileAsync open with a controllable promise so we
    // can fire a second tap while still in 'generating'.
    let resolvePrint:
      | ((v: { uri: string; numberOfPages: number }) => void)
      | null = null;
    printToFileAsyncMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePrint = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    // First tap.
    const onShareRef =
      result.current.state.kind === 'idle'
        ? result.current.state.onShare
        : null;
    expect(onShareRef).not.toBeNull();
    act(() => {
      onShareRef?.();
    });
    assertKind(result.current.state, 'generating');

    // Second tap while still generating — must not fire a second
    // printToFileAsync call (idempotent guard).
    act(() => {
      onShareRef?.();
    });
    expect(printToFileAsyncMock).toHaveBeenCalledTimes(1);

    // Resolve the print so the test cleans up.
    act(() => {
      resolvePrint?.({
        uri: 'file:///tmp/receipt-test.pdf',
        numberOfPages: 1,
      });
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('shared');
    });
  });

  it('onDismissError clears the error and returns to idle', async () => {
    printToFileAsyncMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });
    assertKind(result.current.state, 'error');

    act(() => {
      result.current.state.kind === 'error' &&
        result.current.state.onDismissError();
    });
    assertKind(result.current.state, 'idle');
  });

  it('shared arm exposes onShare so the rider can request a second copy', async () => {
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel(baseArgs()),
    );

    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('shared');
    });
    assertKind(result.current.state, 'shared');
    expect(typeof result.current.state.onShare).toBe('function');

    // Re-share runs the full pipeline again.
    act(() => {
      result.current.state.kind === 'shared' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('shared');
    });
    expect(printToFileAsyncMock).toHaveBeenCalledTimes(2);
    expect(shareAsyncMock).toHaveBeenCalledTimes(2);
  });

  it('passes paymentBrand + paymentLast4 through to the HTML when wallet-cache hits', async () => {
    const { result } = renderHook(() =>
      useGenerateReceiptPdfViewModel({
        ...baseArgs(),
        paymentBrand: 'visa',
        paymentLast4: '4242',
      }),
    );
    act(() => {
      result.current.state.kind === 'idle' && result.current.state.onShare();
    });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('shared');
    });
    const callArg = printToFileAsyncMock.mock.calls[0]?.[0] as { html: string };
    expect(callArg.html).toContain('•••• 4242');
    expect(callArg.html).toContain('Visa');
  });
});
