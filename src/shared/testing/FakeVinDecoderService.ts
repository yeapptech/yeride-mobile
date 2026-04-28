import type { Vin } from '@domain/entities/Vin';
import type { NetworkError } from '@domain/errors';
import type { VinDecodeResult, VinDecoderService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Programmable fake `VinDecoderService` for tests. Default behavior:
 * `decode` returns `Result.ok(null)` (no-match) for every VIN unless one
 * has been registered via `whenVin(vin).respondWith(result)` or
 * `whenVin(vin).respondWithNetworkError(err)`.
 *
 * Two-stage chain syntax keeps the test readable:
 *
 *   const decoder = new FakeVinDecoderService();
 *   decoder.whenVin(vin).respondWith({ make: 'Honda', ... });
 *   const r = await decoder.decode(vin);     // → Result.ok(decoded)
 *
 *   decoder.whenVin(vin).respondWithNetworkError(myErr);
 *   const r = await decoder.decode(vin);     // → Result.err(myErr)
 */
type Response =
  | { kind: 'ok'; value: VinDecodeResult }
  | { kind: 'no_match' }
  | { kind: 'error'; error: NetworkError };

export class FakeVinDecoderService implements VinDecoderService {
  private responses = new Map<string, Response>();
  private decodeCount = 0;

  whenVin(vin: Vin): {
    respondWith: (value: VinDecodeResult) => void;
    respondWithNoMatch: () => void;
    respondWithNetworkError: (error: NetworkError) => void;
  } {
    const key = String(vin);
    return {
      respondWith: (value) => {
        this.responses.set(key, { kind: 'ok', value });
      },
      respondWithNoMatch: () => {
        this.responses.set(key, { kind: 'no_match' });
      },
      respondWithNetworkError: (error) => {
        this.responses.set(key, { kind: 'error', error });
      },
    };
  }

  /** Number of calls made — useful for "we didn't refetch" assertions. */
  get callCount(): number {
    return this.decodeCount;
  }

  async decode(
    vin: Vin,
  ): Promise<Result<VinDecodeResult | null, NetworkError>> {
    this.decodeCount += 1;
    const response = this.responses.get(String(vin));
    if (!response) return Result.ok(null);
    if (response.kind === 'ok') return Result.ok(response.value);
    if (response.kind === 'no_match') return Result.ok(null);
    return Result.err(response.error);
  }

  reset(): void {
    this.responses.clear();
    this.decodeCount = 0;
  }
}
