import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import type { Role } from '@domain/entities/Role';
import type { User } from '@domain/entities/User';
import { makeUser } from '@domain/entities/User';
import type {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Create a new YeRide account: Firebase Auth user + Firestore user document
 * + send verification email. The user is auto-signed-in by Firebase Auth as
 * a side effect of signUp.
 *
 * The presentation layer handles routing — this use case never navigates.
 *
 * Validation that fails before any I/O:
 *   - Email malformed
 *   - Name empty / too long
 *   - Phone malformed (when provided)
 *
 * Errors surfaced from the auth subsystem:
 *   - Password too short → ValidationError
 *   - Email already in use → ConflictError
 *
 * Errors surfaced from the user subsystem:
 *   - Conflict on user doc creation → ConflictError (shouldn't happen but
 *     defensively handled — typically means a previous register attempt
 *     half-completed).
 */
export class RegisterUser {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    role: Role;
  }): Promise<
    Result<{ user: User }, ValidationError | ConflictError | AuthorizationError>
  > {
    const emailR = Email.create(input.email);
    if (!emailR.ok) return emailR;

    const nameR = PersonName.create({
      first: input.firstName,
      last: input.lastName,
    });
    if (!nameR.ok) return nameR;

    let phone: PhoneNumber | null = null;
    if (
      input.phone !== undefined &&
      input.phone !== null &&
      input.phone !== ''
    ) {
      const phoneR = PhoneNumber.create(input.phone);
      if (!phoneR.ok) return phoneR;
      phone = phoneR.value;
    }

    const signUpR = await this.auth.signUp({
      email: emailR.value,
      password: input.password,
    });
    if (!signUpR.ok) return signUpR;
    const userId = signUpR.value;

    const now = this.clock();
    const user = makeUser(input.role, {
      id: userId,
      email: emailR.value,
      emailVerified: false,
      name: nameR.value,
      phone,
      createdAt: now,
      updatedAt: now,
    });

    const createR = await this.users.create(user);
    if (!createR.ok) return createR;

    // Fire-and-forget the verification email — don't fail registration if
    // sending it fails (the user can retry from the EmailVerification screen).
    void this.auth.sendEmailVerification();

    return Result.ok({ user: createR.value });
  }
}
