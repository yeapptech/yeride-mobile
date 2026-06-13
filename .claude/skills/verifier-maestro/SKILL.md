---
name: verifier-maestro
description: Use when running or verifying YeRide-Next UI behavior on a real device with Maestro — booting the dev client, driving driver/rider e2e flows, capturing screenshots as evidence, switching accounts, or seeding a ride for a test. Covers the Android emulator (driver) + iOS sim (rider), Metro, and the expo dev client.
---

# verifier-maestro — drive the YeRide dev client with Maestro

The build/launch/observe handle for `verify` and `run` on this repo: cold-start
the dev client on a device and drive `e2e/maestro/` flows, capturing screenshots
as the evidence. Flows + per-flow gotchas live in `e2e/maestro/README.md`; this
is the rig setup around them.

## Prerequisites

- Maestro on PATH: `export PATH="$PATH:$HOME/.maestro/bin"` (needs Java 17+).
- A debug dev-client build installed (`app.yeride.dev`):
  `android/app/build/outputs/apk/debug/app-debug.apk`. **JS/TS-only changes
  hot-load from Metro — no native rebuild**; reuse the installed APK.
- Creds in `e2e/.env.e2e` (`DRIVER_*` / `RIDER_*`). Backend = `yeapp-stage`
  (shared with legacy) — writes are real; completing a trip charges a Stripe
  **test** card.

## Bring up the rig (Android = driver)

1. **Boot:** `emulator -avd Pixel_9_Pro -no-snapshot-load &` — run detached; do
   **NOT** pipe through `head`/`tail` (the SIGPIPE on close kills the emulator).
   Wait for it: `adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done`.
2. **Metro:** `npx expo start --dev-client --port <PORT> &`. Port 8081 may be
   taken (`lsof -nP -iTCP:8081 -sTCP:LISTEN`); if so pick a free one (e.g. 8082)
   and `adb reverse tcp:8081 tcp:<PORT>`.
3. **Launch + connect:** `adb shell monkey -p app.yeride.dev -c android.intent.category.LAUNCHER 1`,
   then run `e2e/maestro/_lib/connect-metro.yaml` (taps the discovered
   `10.0.2.2:<port>` dev-server entry; first bundle ~30–60 s).
4. **Disable the floating Expo "Tools button"** once (dev menu → toggle it off,
   ~`1171,2034` on a 1280×2856 screen) — left on, it intercepts taps and reopens
   the dev menu. Close the dev menu via its ✕/toggle, **not** the BACK key.
5. **Location:** `adb emu geo fix -80.2331 26.1276` (Plantation, FL) so the
   service-area query resolves (otherwise "No services in this area").

## Drive flows

- Run a flow: `maestro --device <serial> test -e KEY=VAL <flow.yaml>`.
  **`-e` flags go AFTER `test`**, `--device` before it. Examples here use
  `emulator-5554` (the default single-emulator serial); confirm yours with
  `adb devices`.
- Reusable building blocks in `e2e/maestro/_lib/`:
  `connect-metro.yaml`, `sign-in-as.yaml` (sign out + in; env `EMAIL`/`PASSWORD`),
  `go-online.yaml`, `tap-tab.yaml`.
- The full catalog (auth, rider, driver, scheduled-ride) + per-flow gotchas is in
  `e2e/maestro/README.md`. Prefer `testID`s over coordinates.

## Capture evidence

- Screenshot: `adb exec-out screencap -p > shot.png && sips -Z 1000 shot.png`
  then Read it. **Downscale before reading** — full-res is huge (bump `-Z` to
  ~1400 if small text is unreadable).
- Find elements / bounds when a `testID` is missing:
  `maestro --device <serial> hierarchy > h.json`. Each node is
  `{"attributes": {text, resource-id, accessibilityText, bounds, clickable},
"children": [...]}` (fields are under `attributes`, not top-level), so recurse:

  ```bash
  python3 -c 'import json,sys
  def w(n):
   a=n.get("attributes",{})
   if a.get("resource-id") or a.get("text"): print(a.get("resource-id"),"|",a.get("text"),"|",a.get("bounds"))
   [w(c) for c in n.get("children",[])]
  w(json.load(open("h.json")))'
  ```

  Tap-by-point uses the bounds centre when no `testID` exists (e.g. native
  pickers): `tapOn: { point: <cx>,<cy> }`.

## Gotchas

- `emulator | head` → SIGPIPE kills the emulator. Run it detached, unpiped.
- The **sign-in form has no field testIDs**; tapping the placeholder only works
  on an empty field, and the keyboard can overlap the password input
  (concatenating it into the email field). Use `_lib/sign-in-as.yaml`, which
  hides the keyboard between fields and erases each — and start from a clean
  "Welcome back" (force-stop + relaunch if a prior run left junk in a field).
- **Native Android date/time picker** (schedule): no testIDs. The date dialog is
  a Material calendar whose day cells expose a11y labels like `"20 June 2026"` →
  `tapOn` matches them; the time dialog just needs OK (a future date clears the
  15-min floor). See `rider/book-scheduled-ride.yaml`.
- Driver **available-rides feed** may not include a freshly-created scheduled
  ride right after signing in already-online — toggle Go offline→online once to
  re-subscribe after the offered-services query resolves.
- **iOS sim = rider** by convention (it has no GPS routes for movement). It can't
  use `adb reverse`; if 8081 is taken you must point the iOS dev client at the
  chosen port by hand, so Android-only is simpler for solo driver verification.

## Reference

`e2e/maestro/README.md` (flow catalog + gotchas) · memory `maestro_e2e_ui_testing`.
