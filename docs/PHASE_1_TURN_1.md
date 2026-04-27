# Phase 1 — Turn 1: Domain + Use Cases

This turn delivered the **domain layer** and the **use-case layer** for auth +
user identity, end-to-end, with full unit-test coverage. **No Firebase,
no screens, no navigation yet** — those land in turn 2.

The cleanest read of "Phase 1" is: build the inside-out layers first
(domain → app), prove they compose, then bolt the outer layers (data,
presentation) on. We did the inside half this turn.

## What's in

### Domain (`src/domain/`)

| Entity / type               | File                             | Notes                                                   |
| --------------------------- | -------------------------------- | ------------------------------------------------------- |
| `UserId`                    | `entities/UserId.ts`             | Branded string, validates Firebase 28-char alphanumeric |
| `Role`                      | `entities/Role.ts`               | `'rider' \| 'driver'` literal union + type guard        |
| `PersonName`                | `entities/PersonName.ts`         | Immutable first/last with bounds + trim                 |
| `SavedPlace`                | `entities/SavedPlace.ts`         | Plus `SavedPlaceId` branded type                        |
| `User` / `Rider` / `Driver` | `entities/User.ts`               | Discriminated union + immutable update helpers          |
| `AuthRepository`            | `repositories/AuthRepository.ts` | Domain interface, no Firebase imports                   |
| `UserRepository`            | `repositories/UserRepository.ts` | Domain interface                                        |

All factories return `Result<T, ValidationError>`; never throw.

### App / use cases (`src/app/usecases/auth/`)

| Use case                | Failure modes covered                                                |
| ----------------------- | -------------------------------------------------------------------- |
| `RegisterUser`          | malformed email/name/phone; weak password; email already in use      |
| `LogInUser`             | malformed email; user not found; wrong password                      |
| `LogOutUser`            | (always succeeds)                                                    |
| `SendEmailVerification` | no current user                                                      |
| `CheckEmailVerified`    | no current user; user doc missing; idempotent on already-verified    |
| `ResetPassword`         | malformed email                                                      |
| `ChangeEmail`           | malformed email; wrong password (reauth); email in use; user missing |
| `UpdateProfile`         | malformed name/phone; phone clear with `null` or `''`; not signed in |
| `UploadAvatar`          | empty image URI; not signed in                                       |
| `AddSavedPlace`         | invalid coords/label/id; duplicate id; not signed in                 |
| `UpdateSavedPlace`      | place not found; invalid coords; partial update (label or coords)    |
| `RemoveSavedPlace`      | place not found; invalid id; not signed in                           |

Total: **12 use cases**, each with 3–9 unit-test scenarios.

### Test infrastructure (`src/shared/testing/`)

- `InMemoryAuthRepository` — full AuthRepository fake with email/password
  store, signed-in observer notifications, verification + reauth spies.
- `InMemoryUserRepository` — full UserRepository fake with subscription
  notifications, conflict detection, avatar URL stub.
- `TestContainerProvider` — accepts `auth`, `users`, or `useCases`
  overrides. Tests can seed accounts before mounting and assert on spies
  after.

## What's deferred to turn 2

- Firebase data adapters: `FirebaseAuthClient`, `FirestoreUserRepository`,
  `FirebaseStorageClient`. Includes the `expo-build-properties`
  `useModularHeaders: true` configuration to avoid the iOS pod failure
  documented in Phase 0 troubleshooting.
- Real screens: `LogIn`, `Register`, `EmailVerification`, `ForgotPassword`,
  `UserProfile`. Each backed by a view-model hook that calls into the
  use cases via `useUseCases()`.
- `AuthNavigator` + `RootNavigator` updates: route between auth stack and
  the (placeholder) main stack based on session state.
- `useSessionStore` (Zustand) — first real client-state store.
- `AppContent` skeleton with the auth listener (carrying the lessons from
  the legacy app's CLAUDE.md: 5-second safety timeout, fire-and-forget push
  token registration, etc. — push tokens themselves still deferred to
  Phase 9).
- `google-services.json` / `GoogleService-Info.plist` for the
  `yeride-next.dev` and `yeride-next.stage` Firebase apps (which point at
  the same backend as legacy yeride per §7 Decisions).
- A Detox `auth.test.ts` flow.

## Acceptance for turn 1

`npm run verify` should remain green. Expected counts:

- **`npm test`** — 24 test suites pass (12 from Phase 0 + 12 new use-case
  - entity suites). Roughly 180 individual assertions.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors (the boundaries deprecation warnings
  remain as noted in Phase 0).
- **`npm run format:check`** — clean.

The Hello YeRide screen continues to render and the Greet button still
works — the DI container now wires the auth/user fakes, but
`HelloYeRideScreen` doesn't call them.

## Notes on the in-memory fakes living in `presentation/di/container.ts`

`buildContainer()` currently imports from `@shared/testing` to wire up
in-memory `AuthRepository` + `UserRepository` instances. This is allowed
by the boundaries rule (`presentation` may import from `shared`) but is
deliberately a bridge: in turn 2, that import is replaced with the real
Firebase data sources from `data/` and the in-memory implementations stay
confined to test code.

A `LOG.warn` fires at app start to remind us that auth state isn't
persisted yet.
