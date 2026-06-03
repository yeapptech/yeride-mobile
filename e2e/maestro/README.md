# Maestro UI flows

Automated driver + rider UI walkthroughs for the YeRide-Next dev client,
driven with [Maestro](https://maestro.mobile.dev). They tap real `testID`s
(not coordinates) so they run identically on the Android emulator and the
iOS simulator.

## Prerequisites

- Maestro CLI: `curl -Ls "https://get.maestro.mobile.dev" | bash` (needs Java 17+).
- A **dev-client build installed** and **Metro running** (`npm run start`):
  - Android: `npm run android` (or install `android/app/build/outputs/apk/debug/app-debug.apk` and `adb reverse tcp:8081 tcp:8081`).
  - iOS: `npm run ios`.
- App id: `app.yeride.dev`.

## Running

```bash
export PATH="$PATH:$HOME/.maestro/bin"

# Target a specific device when more than one is connected:
maestro --device emulator-5554 test e2e/maestro/driver/walkthrough.yaml
maestro --device <ios-udid>   test e2e/maestro/rider/walkthrough.yaml
```

Sign-in is parameterized — never hard-code credentials:

```bash
maestro -e EMAIL=you@example.com -e PASSWORD=secret test e2e/maestro/auth/sign-in.yaml
```

`book-ride.yaml` expects the address strings AND the exact autocomplete-result
strings to tap:

```bash
maestro -e PICKUP="9251 W Sunrise Blvd, Plantation" \
        -e PICKUP_RESULT="9251 W Sunrise Blvd, Plantation, FL, USA" \
        -e DROPOFF="13550 W Sunrise Blvd, Sunrise" \
        -e DROPOFF_RESULT="13550 W Sunrise Blvd, Sunrise, FL, USA" \
        test e2e/maestro/rider/book-ride.yaml
```

## Flows

| Flow                              | What it does                                                                |
| --------------------------------- | --------------------------------------------------------------------------- |
| `auth/sign-in.yaml`               | Sign in from "Welcome back" (env `EMAIL`/`PASSWORD`).                       |
| `auth/sign-out.yaml`              | Sign out from a tabbed surface.                                             |
| `auth/dismiss-soft-asks.yaml`     | Dismiss dev-client launcher + push soft-ask.                                |
| `_lib/tap-tab.yaml`               | Cross-platform bottom-tab tap (text on Android, point on iOS).              |
| `driver/walkthrough.yaml`         | Driver tabs + trip detail + vehicles (read-only, screenshots).              |
| `driver/accept-and-complete.yaml` | Dispatch → accept → arrive → start → **charge** → complete (env `RIDE_ID`). |
| `rider/walkthrough.yaml`          | Rider tabs Home/Activity/Wallet/Profile (read-only).                        |
| `rider/book-ride.yaml`            | Book an Economy ride → awaiting-driver (creates a **real** ride).           |
| `rider/cancel-ride.yaml`          | Cancel the active ride (reason: changed mind).                              |

## Two-device paired E2E

The full trip needs a driver and a rider on separate devices. The Android
emulator has GPS routes defined, so it should be the **driver**; the iOS
simulator is the **rider**.

1. Android: `sign-in` as driver → `dismiss-soft-asks` → tap online toggle.
2. iOS: `sign-in` as rider → `book-ride` (capture the `rideId` from the
   `RouteSelectVM confirm: ride created` log line in Metro).
3. Android: `accept-and-complete` with `-e RIDE_ID=<that id>`.
4. iOS: the receipt appears; scroll the receipt up before tapping a tip preset
   (the tip row sits behind the sticky footer until you scroll).

## Gotchas discovered

- A rider with an **active ride is auto-routed to the ride monitor** (no tab
  bar) — you cannot reach Profile/Sign-out until the ride is cancelled or
  completed.
- On the **RouteSelect** screen the ride-option list is below the fold on
  smaller screens; expand the bottom sheet (swipe up) before selecting.
- On the **rider Receipt**, the tip presets + submit button render **behind the
  sticky "Share receipt / Done" footer**; scroll the content up first or taps
  land on the footer.
- On **iOS**, the React-Navigation bottom-tab labels (`Home`/`Activity`/
  `Wallet`/`Profile`) are **not matchable by `tapOn: text`** in Maestro (they
  resolve fine on Android). This is handled transparently by `_lib/tap-tab.yaml`,
  which the walkthroughs use: it taps by text on Android and by point on iOS
  (tabs are evenly spaced at y≈96% — Home 12%, Activity 37%, Wallet/Earnings
  62%, Profile 87%). So `*/walkthrough.yaml` now run on both platforms. If the
  tab count or order changes, update the point percentages in that helper.
