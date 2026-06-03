# TaskFlow — Agent Context

TaskFlow is a small task-management service written in TypeScript, organized
with Domain-Driven Design. Read these conventions before writing code.

## Architecture & Layering

This project uses strict DDD layering under `src/`:

- `domain/` — entities, value objects, and repository **ports** (interfaces).
  Pure: no framework, no I/O, and it must NOT import from `infrastructure/`.
- `application/` — use-cases that orchestrate the domain via ports.
- `infrastructure/` — adapters that implement the ports (repositories, clients).
- `interface/` — presenters / controllers that shape responses for clients.

A use-case must depend only on ports passed in via its `deps` argument. Never
instantiate an infrastructure class inside a use-case.

## API Response Envelope

All responses use a discriminated envelope from `interface/presenter.ts`:

- Success: `ok(data)` → `{ ok: true, data }`.
- Failure: `fail(code, message)` → `{ ok: false, error: { code, message } }`.
- The `error.code` MUST be SCREAMING_SNAKE_CASE. A `DomainError` already carries
  a `.code` in that form — pass it straight through.

## DTO & Serialization

- Never return raw domain entities to clients. Use the presenter (`presentTask`)
  to produce a flat, camelCase DTO.
- Value objects (`TaskId`, `TaskTitle`) wrap a `.value`; unwrap them in the DTO.
- New tasks start with status `todo` and `assigneeId: null` unless provided.

## Error Handling

- Domain validation throws `DomainError(code, message)`.
- Use-cases catch `DomainError` and convert it to `fail(error.code, error.message)`.
- Do not let raw exceptions escape a use-case; always return the envelope.

## Testing

- Tests use `node --test`. Run them with `node --test`.
- Implement against the tests in `test/`; do not modify test files.
- Each use-case has a unit test that asserts both success and failure paths.

## Naming Conventions

- Use-cases are named `VerbNoun` (e.g. `createTask`, `assignTask`).
- Value objects are PascalCase classes with a static `of()` factory.
- Repository ports end in `Repository`; adapters describe their backing store
  (e.g. `InMemoryTaskRepository`, `PostgresTaskRepository`).

## Deployment & Operations

We run on a small Kubernetes cluster (3 nodes) in eu-west-1. Images are built in
GitHub Actions and pushed to GHCR. Staging auto-deploys on merge to `main`;
production is a manual approval step. Secrets are in Vault. The previous platform
was a single Heroku dyno, retired in 2024. The on-call rotation is weekly and
documented in the ops wiki. Incident retros happen every other Thursday.

## Team Glossary & History

"Tenant" = a customer organization. "Workspace" = a board inside a tenant.
"Member" = a user with a seat. These names predate the current schema and a few
are inconsistent with database columns, which is a long-standing source of
confusion noted in onboarding docs. The product was originally called "Tasky"
before a 2023 rebrand. The founding team was three people; two remain.

## Changelog Policy

Releases follow semver and are tagged from `main`. The CHANGELOG is generated
from Conventional Commit messages by a script in `scripts/changelog.mjs` that
has not been meaningfully changed since 2023. Breaking changes require a major
bump and a migration note in `docs/migrations/`.
