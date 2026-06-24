# Maestro UI flows

Automated driver + rider UI walkthroughs for the YeRide-Next dev client,
driven with [Maestro](https://maestro.mobile.dev). They prefer real `testID`s
so they run on both the Android emulator and the iOS simulator. The one
exception is the bottom-tab bar, whose labels aren't text-matchable on iOS —
tab taps go through `_lib/tap-tab.yaml`, which falls back to a point tap there
(see Gotchas).

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

| Flow                                 | What it does                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/sign-in.yaml`                  | Sign in from "Welcome back" (env `EMAIL`/`PASSWORD`).                                                                                                                           |
| `auth/sign-out.yaml`                 | Sign out from a tabbed surface.                                                                                                                                                 |
| `auth/dismiss-soft-asks.yaml`        | Dismiss dev-client launcher + push soft-ask.                                                                                                                                    |
| `_lib/tap-tab.yaml`                  | Cross-platform bottom-tab tap (text on Android, point on iOS).                                                                                                                  |
| `driver/walkthrough.yaml`            | Driver tabs + trip detail + vehicles (read-only, screenshots).                                                                                                                  |
| `driver/accept-and-complete.yaml`    | Dispatch → accept → arrive → start → **charge** → complete (env `RIDE_ID`).                                                                                                     |
| `driver/accept-scheduled-ride.yaml`  | Accept a scheduled ride → Home Scheduled → **Begin** → DriverMonitor (env `RIDE_ID`; no charge).                                                                                |
| `driver/dispatch-already-taken.yaml` | Loser path: open dispatch for an awaiting ride, it leaves `awaiting_driver` (rival claim / rider cancel) → **"Already taken"** panel → back to Home (env `RIDE_ID`; no charge). |
| `rider/walkthrough.yaml`             | Rider tabs Home/Activity/Wallet/Profile (read-only).                                                                                                                            |
| `rider/book-ride.yaml`               | Book an Economy ride → awaiting-driver (creates a **real** ride).                                                                                                               |
| `rider/book-scheduled-ride.yaml`     | Book a **scheduled** Economy ride → "Ride Scheduled!" (creates a real `scheduled` ride; env `DAY_LABEL`).                                                                       |
| `rider/cancel-ride.yaml`             | Cancel the active ride (reason: changed mind).                                                                                                                                  |

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

**Loser / "Already taken" variant** (`driver/dispatch-already-taken.yaml`) —
exercises the first-come-first-served claim's drift-to-`gone` path:

1. iOS: `sign-in` as rider → `book-ride` (capture the `rideId`).
2. Android: start `dispatch-already-taken` with `-e RIDE_ID=<that id>`. It opens
   the dispatch screen (accept visible) and then waits up to 60s for the
   "Already taken" panel.
3. iOS: while Android is waiting, run `rider/cancel-ride.yaml` (or have a second
   driver accept the ride). The driver's live `ObserveRide` drifts off
   `awaiting_driver` → the panel appears and the flow dismisses back to Home.

## Gotchas discovered

- A rider/driver with an active ride is **no longer auto-routed** to the
  monitor and is never trapped: Home shows their in-progress and scheduled
  rides as a tappable list (riders see pending + driver-accepted scheduled
  rides; drivers see the scheduled rides they've accepted), and every tab
  (Profile/Sign-out/etc.) stays reachable. Tap an in-progress row to open
  the monitor; tap an accepted scheduled row (driver) to begin it.
  (Replaces the short-lived active-ride banner.)
- The rider home **needs a resolved location to show ride services** — on the
  iOS simulator a cold start can default to a far-away region, leaving
  RouteSelect on "No services in this area". Set a location first, e.g.
  `xcrun simctl location <udid> set 26.1276,-80.2331` (Plantation, FL), then
  relaunch so the service-area query resolves before `book-ride`.
- On **iOS** the system **"Save Password"** prompt and the Expo **dev-menu gear**
  (top-right) can intercept taps during `sign-in`. Disable Settings → General →
  AutoFill & Passwords → AutoFill Passwords once, and avoid point-taps near the
  top-right gear.
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
- The **schedule picker** (`book-scheduled-ride.yaml`) drives the Android
  **native** date + time dialogs, which have no testIDs. The date dialog is a
  Material calendar for the current month; each day cell exposes an
  accessibility label like `"20 June 2026"`, so `tapOn` matches it — pass a
  future, enabled day via env `DAY_LABEL`. The time dialog is just OK'd (any
  time clears the 15-min floor once the date is in the future).
- The driver **available-rides feed** only includes a ride once the driver's
  offered-services query (active service area → services) has resolved. If a
  freshly-created scheduled ride doesn't show as a `driver-ride-card-*` right
  after signing in already-online, toggle **Go offline → Go online** once to
  re-subscribe with the resolved services. Accepting it then moves it from the
  available stack into the Home **Scheduled** section (`trip-card-*`).
