# Contributing — Common task recipes

How to add the most common kinds of building block. The patterns
expand on rules covered in `../CLAUDE.md`; if a recipe and the guide
disagree, the guide wins.

## Adding a use case

1. New file in `src/app/usecases/<context>/<UseCaseName>.ts`.
2. Constructor takes whatever repos / services it needs.
3. `execute(args): Promise<Result<T, DomainError>>` (or sync for
   subscription-shaped).
4. Wire into `src/presentation/di/container.ts`'s `UseCases`
   interface + `makeUseCases()` body.
5. Tests in `__tests__/<UseCaseName>.test.ts` using
   `InMemory<X>Repository` fakes from `@shared/testing`.

## Adding a domain entity

1. New file in `src/domain/entities/<Name>.ts`.
2. Private constructor + `static create(props): Result<X, ValidationError>`
   factory.
3. Tests in `__tests__/<Name>.test.ts` covering happy path + every
   validation rejection (one assertion per `code` string).
4. Re-export via `src/domain/entities/index.ts` only if multiple
   files need it (most stay direct-imported).

## Adding a Firestore repository

1. Define the interface in `src/domain/repositories/<X>Repository.ts`.
2. Build the in-memory fake first in
   `src/shared/testing/InMemory<X>Repository.ts` — exercise the
   contract.
3. Build the real adapter in
   `src/data/repositories/Firestore<X>Repository.ts` (and a
   `<X>Doc.ts` schema + bidirectional mapper if persistence is
   needed).
4. Wire into the DI container with a lazy `require()`.
5. Add an optional override to `TestContainerProvider`.

## Adding an SDK seam

See the "SDK seams: domain interface + data adapter + fake" section
of `../CLAUDE.md` for the five-step procedure. Canonical example:
`CrashReportingService` (interface in `@domain/services`, adapter in
`@data/services`, fake in `@shared/testing`).

If the SDK is a one-shot call with no listener stream and no mirrored
permission state, the single-call escape hatch may apply instead —
see the same section in the guide.
