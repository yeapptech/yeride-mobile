import type { Vin } from '@domain/entities/Vin';
import type { NetworkError } from '@domain/errors';
import type {
  VinDecodeResult,
  VinDecoderService,
} from '@domain/services/VinDecoderService';
import type { Result } from '@domain/shared/Result';

/**
 * Trivial wrap of `VinDecoderService.decode`. The value is in DI: the
 * presentation layer calls a use case, not the service directly, so tests
 * can swap `FakeVinDecoderService` in via `TestContainerProvider`.
 */
export class DecodeVin {
  constructor(private readonly decoder: VinDecoderService) {}

  execute(args: {
    vin: Vin;
  }): Promise<Result<VinDecodeResult | null, NetworkError>> {
    return this.decoder.decode(args.vin);
  }
}
