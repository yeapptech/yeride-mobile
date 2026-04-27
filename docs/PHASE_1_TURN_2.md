# Phase 1 — Turn 2: Firebase Adapters + Real Auth UI

This turn completes Phase 1: real Firebase data adapters wired in, five
real auth screens with view-models, conditional auth-vs-main routing, and
the AppContent listener that drives the session store.

## What's in

### Data layer (`src/data/`)

| Path                                      | Notes                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dto/UserDoc.ts`                          | Zod schema for the Firestore `users/{uid}` document. Permissive parse (accepts legacy `phone` alias, missing `updatedDateTime`, etc.) so we can read what the legacy yeride app wrote. Canonical write shape on the way out. |
| `mappers/userMapper.ts`                   | `parseUserDoc` (raw → DTO), `toDomain(uid, doc)` (DTO → User), `toDoc(user)` (User → DTO). 13 unit tests including a domain → doc → domain round-trip.                                                                       |
| `repositories/FirebaseAuthRepository.ts`  | Implements `AuthRepository` via `@react-native-firebase/auth` modular API. Maps Firebase `auth/*` error codes to YeRide DomainError subtypes. Uses `verifyBeforeUpdateEmail` for the email-change flow.                      |
| `repositories/FirestoreUserRepository.ts` | Implements `UserRepository` via `@react-native-firebase/firestore` + `/storage`. Saved-place writes use `arrayUnion` / `arrayRemove` for atomic concurrent edits.                                                            |

### Presentation layer (`src/presentation/`)

| Path                                                | Notes                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stores/useSessionStore.ts`                         | First Zustand store. Tracks `status: 'initializing' \| 'unauthenticated' \| 'authenticated'` + the userId. Selector hooks for fast reads. 5 unit tests.                                    |
| `navigation/types.ts`                               | `AuthStackParamList`, `MainStackParamList`, screen-prop helpers. `useNavigation()` is fully typed via the `ReactNavigation.RootParamList` augmentation.                                    |
| `navigation/AuthNavigator.tsx`                      | Native-stack: LogIn / Register / EmailVerification / ForgotPassword.                                                                                                                       |
| `navigation/MainNavigator.tsx`                      | Phase 1 placeholder: Home + UserProfile. Replaced by RiderTabs / DriverTabs in Phase 3.                                                                                                    |
| `navigation/RootNavigator.tsx`                      | Conditional routing on `useSessionStatus()`. Splash for `initializing`, AuthNavigator for `unauthenticated`, MainNavigator for `authenticated`.                                            |
| `components/form/FormField.tsx`                     | Labeled `TextInput` with error / helper text. Used by every auth screen.                                                                                                                   |
| `features/auth/screens/LogInScreen.tsx`             | Email + password, with view-model `useLogInViewModel`.                                                                                                                                     |
| `features/auth/screens/RegisterScreen.tsx`          | First/last/email/phone/password + role picker. View-model navigates to EmailVerification on success.                                                                                       |
| `features/auth/screens/EmailVerificationScreen.tsx` | Polls `checkEmailVerified` every 5s; offers resend; shows ✓ when verified.                                                                                                                 |
| `features/auth/screens/ForgotPasswordScreen.tsx`    | Email entry → reset link. Shows confirmation state without leaking whether the address exists.                                                                                             |
| `features/auth/screens/UserProfileScreen.tsx`       | Edit name + phone. Avatar slot is a placeholder ("Phase 9"). Saved-places section says "Phase 2".                                                                                          |
| `features/auth/screens/HomePlaceholderScreen.tsx`   | Phase 1 placeholder: "You're signed in" + edit-profile + sign-out.                                                                                                                         |
| `features/auth/view-models/use*.ts`                 | Five view-model hooks. Each owns submitting/error state and dispatches use cases. Navigation is reactive via the session listener — view-models don't navigate on the happy path.          |
| `AppContent.tsx`                                    | Subscribes to `observeAuthState`; drives session store; 5-second safety timeout flips to `unauthenticated` if Firebase Auth never reports back. Carries the lessons from legacy CLAUDE.md. |
| `App.tsx`                                           | Provider stack: GestureHandlerRootView → SafeAreaProvider → QueryClientProvider → ContainerProvider → AppContent → NavigationContainer → RootNavigator.                                    |

### App layer additions

- `app/usecases/auth/GetCurrentUser.ts` — one-shot read for screens (the
  UserProfile load path).
- `app/usecases/auth/ObserveAuthState.ts` — subscription-shaped use case
  used by `AppContent` to drive the session store.

### Config + tooling

- `app.config.ts` — env-aware Firebase config-file resolution: env var (CI) →
  checked-in `firebase/config/<env>/` path → omitted. Sets `extra.firebaseConfigured`
  flag for the runtime container. `expo-build-properties` plugin configured
  with `useModularHeaders: true` for iOS to fix the Firebase Swift pod issue
  documented in Phase 0.
- `firebase/config/{dev,stage}/.gitkeep` — placeholders; real config files
  are gitignored.
- `eslint.config.js` — `presentation/di/container.ts` and
  `src/shared/testing/**` get `boundaries/element-types` disabled (the DI
  composition root is allowed to wire every layer; testing fakes
  legitimately need to compose presentation providers). `shared` is now
  allowed to import from `domain` (domain is the architectural floor; small
  helpers that know about DomainError live legitimately in shared).
- New deps: `@react-native-firebase/{app,auth,firestore,storage}@^24.0.0`,
  `@react-native-async-storage/async-storage@2.2.0`, `react-hook-form`,
  `@hookform/resolvers`, `zustand`, `expo-constants`.

### DI container behavior

`buildContainer()` checks `Constants.expoConfig.extra.firebaseConfigured`
(set by `app.config.ts` based on whether config files exist):

- **Configured** → wires `FirebaseAuthRepository` + `FirestoreUserRepository`.
- **Not configured** → wires the in-memory fakes from `@shared/testing` and
  emits a `LOG.warn` at boot.

Lazy `require()` inside the branch ensures the @react-native-firebase
modules are never loaded when fakes are active — important because they
crash at module-load time without config files.

### Phase 0 smoke artifacts

`GreetUser` use case + `HelloYeRideScreen` + their tests are kept dormant
(no longer reachable from any navigator). Couldn't delete files in this
session; flagged for follow-up cleanup. They still pass tests and don't
affect bundle size meaningfully.

## iOS build fix: `withFirebasePodfileFix` config plugin

`@react-native-firebase` 24.x's Obj-C wrappers `#import <React/...>` headers.
Under `useFrameworks: 'static'` (which we need for Firebase's Swift pods
like FirebaseFirestore), Clang rejects those imports with
`-Wnon-modular-include-in-framework-module` unless every pod in the app
generates a module map.

The fix is one Podfile directive: `use_modular_headers!`. Expo's
`expo-build-properties` plugin doesn't expose that knob in SDK 55, so we
ship a custom Expo config plugin at `plugins/withFirebasePodfileFix.ts`.
It uses `withDangerousMod('ios', ...)` to read the Podfile after prebuild
generates it, look for `use_expo_modules!`, and inject
`use_modular_headers!` right after that line. Idempotent — re-running
prebuild doesn't double-insert.

Listed in `app.config.ts` plugins array right after `@react-native-firebase/app`,
so it runs after Expo's own native config and before pod install.

## What's deferred to later turns / phases

- **Detox `auth.test.ts`** — can't write a meaningful flow until you've
  dropped in Firebase config files and pointed at the dev backend. Lands as
  a small follow-up after your first end-to-end smoke test.
- **Avatar upload UI** — Phase 9 polish (per turn 2 scope decision).
- **Saved-places UI** — Phase 2 (lands alongside Google Places autocomplete
  for the route-planning flow).
- **Push tokens** — Phase 9 (per turn 2 scope decision).
- **TanStack Query for the session user** — currently `useUserProfileViewModel`
  fetches imperatively with `getCurrentUser`. A Firestore-subscription-backed
  `useCurrentUserQuery` lands in Phase 2 once we have the `useFirestoreSubscription`
  hook generalized.

## Acceptance for turn 2

`npm run verify` should remain green:

- **`npm test`** — 28 suites pass, 220 tests passing (~6s).
  - 14 added this turn: userMapper (13), useSessionStore (5).
  - Plus 199 from turn 1 + Phase 0.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors. The boundaries v6 deprecation warnings
  are still there as before; migration tracked as a follow-up.
- **`npm run format:check`** — clean.

## How to run the app end-to-end

Until you complete `docs/FIREBASE_SETUP.md`:

```bash
npm run prebuild
npm run ios
# → boots with in-memory fakes
# → LogIn screen renders
# → Register, log in (no email actually sends; nothing persists)
# → A LOG.warn fires at startup so you remember
```

After completing `docs/FIREBASE_SETUP.md`:

```bash
rm -rf ios android   # clear the no-firebase prebuild artifacts
npm run prebuild     # regenerates with Firebase plugins active
npm run ios
# → real Firebase Auth + Firestore behind the scenes
# → registered users appear in Firebase Console → Authentication
# → user docs appear at users/{uid} in Firestore
```

## Risks / known issues to watch on first real-Firebase boot

- **First Android build** will need the debug keystore SHA-1 added to the
  Firebase Android app. `eas credentials` exposes it; or use the standard
  `~/.android/debug.keystore` SHA-1 dev shortcut.
- **iOS pod install** must not regress to the modular-headers error. If it
  does, double-check `useModularHeaders: true` is still in
  `expo-build-properties`'s ios block.
- **Firebase BoM Android** — legacy yeride is pinned to BoM 34.0.0 due to
  gRPC stream-stability issues at 34.10.0. We don't pin yet here because
  RN Firebase 24.x picks a sane default. If `.get()` calls hang after
  login, look at this first (see legacy CLAUDE.md troubleshooting).
- **`verifyBeforeUpdateEmail`** is the modern email-change path. If your
  Firebase console has email-enumeration protection turned off, the
  legacy `updateEmail` would also work — but our adapter only uses the
  verify-before path, which is the recommended secure default.
