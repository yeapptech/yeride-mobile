import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { ServiceAreaRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * List every service area in the catalog.
 *
 * One-shot fetch — service-area data is admin-managed and effectively static
 * within a session. The presentation layer caches results in
 * `useServiceAreaStore`.
 *
 * Returns an empty list (not an error) when no areas exist; the presentation
 * layer surfaces "we don't operate anywhere yet" rather than a fault state.
 */
export class ListServiceAreas {
  constructor(private readonly repo: ServiceAreaRepository) {}

  execute(): Promise<Result<readonly ServiceArea[], never>> {
    return this.repo.listAll();
  }
}
