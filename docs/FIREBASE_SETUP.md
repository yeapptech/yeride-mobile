# Firebase Setup (Phase 1 Turn 2)

`yeride-next` reuses the legacy `yeride` Firebase **dev** and **stage** projects
(see `REFACTOR_PLAN.md` §7 Decision 6). We need to add new iOS + Android
_apps_ inside those projects to match the `yeride-next` bundle IDs, then
download the per-app config files into this repo.

For **production**, we'll create a fresh `yeride-next-prod` Firebase project
later (Phase 9 / 10). For now, only dev and stage matter.

## Bundle IDs to register

From `app.config.ts`:

| Env         | Bundle ID                          |
| ----------- | ---------------------------------- |
| development | `tech.yeapp.yeridenext.dev`        |
| stage       | `tech.yeapp.yeridenext.stage`      |
| production  | `tech.yeapp.yeridenext` (deferred) |

## Steps for each environment (dev, stage)

### iOS — add an app to the legacy Firebase project

1. Open the [Firebase Console](https://console.firebase.google.com).
2. Select the **legacy yeride dev** project (or stage when doing stage).
3. Click the gear icon → **Project settings**.
4. Scroll to **Your apps** → click **Add app** → choose iOS.
5. Fill in:
   - **Bundle ID:** `tech.yeapp.yeridenext.dev` (or `.stage`)
   - **App nickname:** `YeRide Next (Dev)` (or `(Stage)`)
   - **App Store ID:** leave blank
6. Click **Register app**.
7. Click **Download GoogleService-Info.plist**.
8. Place the file at:
   - dev → `firebase/config/dev/GoogleService-Info.plist`
   - stage → `firebase/config/stage/GoogleService-Info.plist`
9. You can skip the rest of the Firebase wizard ("Add Firebase SDK", "Add
   initialization code") — `@react-native-firebase` handles all of that.

### Android — add an app to the legacy Firebase project

1. Same project settings page → **Add app** → Android.
2. Fill in:
   - **Android package name:** `tech.yeapp.yeridenext.dev` (or `.stage`)
   - **App nickname:** `YeRide Next (Dev)`
   - **Debug signing certificate SHA-1:** leave blank for now
     (we'll add it after the first dev build with `eas credentials` or
     manually from `~/.android/debug.keystore`).
3. Click **Register app**.
4. Click **Download google-services.json**.
5. Place the file at:
   - dev → `firebase/config/dev/google-services.json`
   - stage → `firebase/config/stage/google-services.json`
6. Same as iOS, skip the wizard's "Add Firebase SDK" / init steps.

## Final layout

After both env's clicks are done, your `firebase/config/` should look like:

```
firebase/config/
├── dev/
│   ├── GoogleService-Info.plist
│   └── google-services.json
└── stage/
    ├── GoogleService-Info.plist
    └── google-services.json
```

These files are **not committed** — `.gitignore` excludes
`firebase/config/**/GoogleService-Info.plist` and
`firebase/config/**/google-services.json`. Each developer downloads their
own; CI gets them from EAS Secrets when builds run.

## What `app.config.ts` does with them

The Expo build picks the right file based on `APP_ENV`:

```ts
ios: {
  googleServicesFile:
    process.env.GOOGLE_SERVICES_INFOPLIST ??
    `./firebase/config/${APP_ENV}/GoogleService-Info.plist`,
},
android: {
  googleServicesFile:
    process.env.GOOGLE_SERVICES_JSON ??
    `./firebase/config/${APP_ENV}/google-services.json`,
},
```

(That wiring lands in turn 2 alongside this doc.)

## Local dev: I don't have config files yet

Until the files are in place, the app boots with **in-memory auth fakes**
(see `presentation/di/container.ts`). Auth use cases work, no users persist
across app restarts, no email actually sends. A `LOG.warn` fires at startup.

Once the files are in place, set `EXPO_PUBLIC_USE_FIREBASE=true` in
`.env.development` and rebuild — the container will switch over.

## Verifying the setup

After you place the dev files, run:

```bash
EXPO_PUBLIC_USE_FIREBASE=true npm run prebuild   # clean & re-prebuild
npm run ios
```

You should see no Firebase init errors in the Metro log. Try registering
a new test account from the LogIn screen → Register link. The new user
will appear in:

- **Firebase Console → Authentication → Users**
- **Firebase Console → Firestore → users → {uid}**

If you see an `auth/configuration-not-found` error at boot, the
`GoogleService-Info.plist` / `google-services.json` is either missing or
pointing at a different bundle ID than what `app.config.ts` is using.

## CI / EAS Secrets

When running EAS builds:

```bash
eas secret:create --scope project --name GOOGLE_SERVICES_INFOPLIST_DEV \
  --type file --value ./firebase/config/dev/GoogleService-Info.plist
eas secret:create --scope project --name GOOGLE_SERVICES_JSON_DEV \
  --type file --value ./firebase/config/dev/google-services.json
# repeat for stage
```

Then wire those into `eas.json` build profiles:

```json
"development": {
  "env": {
    "APP_ENV": "development",
    "GOOGLE_SERVICES_INFOPLIST": "$GOOGLE_SERVICES_INFOPLIST_DEV",
    "GOOGLE_SERVICES_JSON": "$GOOGLE_SERVICES_JSON_DEV"
  }
}
```

(EAS injects these at build time; the env-var lookup in `app.config.ts`
finds them.)

## Troubleshooting

| Symptom                                                                              | Fix                                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `auth/configuration-not-found` on iOS                                                | `GoogleService-Info.plist` missing or bundle-ID mismatch                                                                   |
| `Default FirebaseApp is not initialized` on Android                                  | `google-services.json` missing or `applicationId` in `android/app/build.gradle` doesn't match                              |
| `pod install` fails with "FirebaseAuth depends upon ... which do not define modules" | `expo-build-properties` plugin needs `ios.useFrameworks: 'static'` — check `app.config.ts`                                 |
| iOS build error around `RCTReactNativeFactory` parameters                            | Mismatched RN version vs Expo SDK — see Phase 0 troubleshooting; we're pinned to RN 0.83.6 / SDK 55                        |
| Firebase BoM (Android) version conflicts                                             | Lock to BoM 34.0.0 via `expo-build-properties`'s `android.gradleProperties` (carry-forward from legacy CLAUDE.md guidance) |
