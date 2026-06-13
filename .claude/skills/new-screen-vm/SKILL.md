---
name: new-screen-vm
description: Use when adding a screen to YeRide-Next and you need the paired view-model hook, the dumb-screen split, and the TestContainerProvider-based view-model test. Also when a screen is doing orchestration it shouldn't.
---

# New Screen + View-Model

## Overview

Every screen in YeRide-Next has a sibling `useXxxViewModel` hook that owns ALL orchestration; the
screen stays dumb — props in, JSX out. The VM is tested in isolation against in-memory repository
fakes; the screen gets a rendered test fed the VM output as props. Canonical rules: `CLAUDE.md`
(§"View-model hooks per screen", §"Zustand vs. TanStack Query") and `docs/PATTERNS.md`.

## The split

**View-model** — `src/presentation/features/<area>/view-models/useXxxViewModel.ts`:

- Pulls use cases off the DI container.
- Wires **TanStack Query** for server state (query keys mirror use-case args).
- Reads/writes the relevant **Zustand** store(s) for UI/client state.
- Maps domain `Result` values into flat UI props — a `loading | error | data` discriminated union.
- Exposes typed callbacks.

**Screen** — `src/presentation/features/<area>/screens/XxxScreen.tsx`:

- Receives the VM output and renders. **No `useUseCases()`, no Firebase imports, no Result-unwrapping.**

## State split (never mix)

- **Server / fetched state** (ride, route catalog, payment methods, available rides) → **TanStack
  Query**, keyed to use-case args. Never put fetched ride/route/payment data in Zustand.
- **UI / client state** (sheet-open, banner-visible, the pre-CreateRide draft, chat open flag) →
  **Zustand**. Never put a pure UI flag in TanStack Query.

## Live-trip surfaces — status-router, not a god-component

If the screen reacts to `Ride.status` (like `RideMonitorScreen` / `DriverMonitorScreen`): switch on
status to pick one `<Status>View` component. Each view takes the `Ride` + callbacks as props and is
independently testable. Adding a status = add a `RideStatus` literal + one `<Status>View` + one
router case. Do not grow one component.

## Test the VM in isolation

Render the VM hook inside `TestContainerProvider` (from `@shared/testing`), supplying in-memory
repository fakes / override slots. Assert it maps fake `Result`s to the right flat props and that
callbacks invoke the right use cases. Then test the screen as a pure render with the VM output
supplied as props.

## Quick reference

| Concern                                          | Where it goes                                           |
| ------------------------------------------------ | ------------------------------------------------------- |
| Use cases, TanStack Query, Zustand, Result→props | the view-model hook                                     |
| Rendering only                                   | the screen                                              |
| Fetched server data                              | TanStack Query (key = use-case args)                    |
| UI flags / drafts                                | Zustand store                                           |
| VM test                                          | `TestContainerProvider` + in-memory fakes               |
| New ride status                                  | `RideStatus` literal + `<Status>View` + one router case |

## Common mistakes

- Calling a use case or unwrapping a `Result` in the screen body → push it into the VM.
- Stashing the fetched `Ride` in Zustand → that's TanStack Query's job.
- A UI flag (sheet open) in TanStack Query → that's Zustand's job.
- Growing `RideMonitorScreen` / `DriverMonitorScreen` instead of adding a `<Status>View`.
