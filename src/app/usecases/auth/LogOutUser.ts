import type { AuthRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Sign the current user out. Idempotent — calling when nobody is signed in
 * is a no-op. The auth listener fires `null` and the navigator routes back
 * to the auth stack.
 */
export class LogOutUser {
  constructor(private readonly auth: AuthRepository) {}

  async execute(): Promise<Result<true, never>> {
    await this.auth.signOut();
    return Result.ok(true);
  }
}
