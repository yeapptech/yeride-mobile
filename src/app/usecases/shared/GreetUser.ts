import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

/**
 * The simplest possible use case. Exists to prove the architecture wiring
 * end-to-end:
 *   presentation → useUseCases() → GreetUser.execute() → domain (Result)
 *
 * It will be deleted in Phase 1 when real auth use cases land.
 */
export class GreetUser {
  execute(input: {
    name: string;
  }): Result<{ greeting: string }, ValidationError> {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'greet_empty_name',
          message: 'Name is required',
          field: 'name',
        }),
      );
    }
    return Result.ok({ greeting: `Hello, ${trimmed}!` });
  }
}
