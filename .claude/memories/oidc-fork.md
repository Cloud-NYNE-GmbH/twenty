# NYNE Twenty Fork — Generic OIDC Login (Authentik)

> TL;DR: NYNE forked Twenty CRM to add a generic OIDC login provider for the intranet (Authentik at `auth.nyne.lan`). OIDC is live since 2026-05-28. Linear: NYNE-212.

## Overview

NYNE forked [Cloud-NYNE-GmbH/twenty](https://github.com/Cloud-NYNE-GmbH/twenty) from upstream `v2.8.3` to add `AuthProviderEnum.Oidc` modeled on the free Microsoft OAuth strategy — no enterprise files touched. Twenty's generic SAML/OIDC SSO is enterprise-licensed (RS256 key gated by twenty.com); Google/Microsoft OAuth and the `signInUpWithSocialSSO` plumbing are free AGPL core. AGPL §13 source-offer satisfied by the internal fork link.

## Branch model

- `main` — upstream `v2.8.3` (base, no NYNE changes)
- `nyne` — NYNE production branch; base for all NYNE changes
- `feature/nyne-212-oidc-login` → merged to `nyne` as PR #1 (ff-push over SSH — see Merging gotcha below)

## Implementation design

- OIDC implemented as a **manual code flow** (PKCE+state+nonce in express-session) in `oidc-auth.controller.ts`, NOT a passport strategy — openid-client's passport integration fights Twenty's stateless social strategies.
- `openid-client@^5.7.0` was already a dep; there is also `oidc.auth.strategy.ts` and `oidc-client.service.ts`.
- Gated at instance level only via `AUTH_OIDC_ENABLED` env var — **no per-workspace DB column, no migration**.
- Treated like `SSO` in `workspace.validate.ts`.
- `generated-metadata/graphql.ts` must be regenerated via `graphql:generate` against a LIVE backend (codegen introspects `localhost:3000/graphql`); the Docker build does NOT regenerate it — the committed file is authoritative. Do not hand-edit it.
- Node 24 required (`^24.5.0`); use `/opt/homebrew/opt/node@24/bin` (machine default may be v26+).

## Deployment

- Custom image `ghcr.io/cloud-nyne-gmbh/twenty`, package visibility: **Internal** (org-wide read).
- Built/pushed manually from a workstation via `nyne-release.sh` (buildx `--platform linux/amd64` — Mac is arm64, LXC is amd64 → GHCR). CI build dropped: twenty-front's 8GB heap OOMs GitHub's 7GB runner AND the 8GB prod LXC.
- **GitHub Actions disabled repo-wide** (`actions/permissions enabled=false`) to silence upstream Twenty's ~20 failing CI workflows.
- Consumed by the `twenty` stack in `intranet-deploy`. Deploy: pin `TWENTY_TAG` + `make up STACK=twenty`.
- To wire auto-deploy: append `gh workflow run deploy-stack.yml --repo Cloud-NYNE-GmbH/intranet-deploy -f stack=twenty -f tag="${TAG}"` at the end of `nyne-release.sh` (mirrors bureau pattern). Verify runner labels (`self-hosted, intranet-lxc`).

## Dockerfile-target gotcha

`packages/twenty-docker/twenty/Dockerfile` last stage is `twenty-app-dev` (all-in-one dev image with embedded Postgres+Redis). `docker buildx build` without `--target` picks that stage → init-db fails with `ERROR: relation "core.workspace" does not exist`. **Always use `--target twenty`** (server+frontend, honours `PG_DATABASE_URL`). `nyne-release.sh` does this. Symptom if it regresses: UUID `20202020-1c25-4d02-bf25-6aeccf7ea419` in logs (only appears in `twenty-app-dev`'s `init-db.sh`).

## Merging gotcha

Merging PRs that touch `.github/workflows/*` via the GitHub API/`gh` fails with "Head branch is out of date" / "refusing to ... workflow without `workflow` scope". SSH pushes bypass this — merge locally + push over SSH, or `gh auth refresh -s workflow`. PR #1 was landed by ff-pushing `nyne` over SSH (auto-marked MERGED).

## Bootstrap (one-time per workspace)

Approved-access-domain `nyne.cloud` must have `isValidated=true` set directly in DB (SMTP not yet wired — domain verification email path unavailable). Auto-join role is Member; admin promotion via UI by an existing Admin (`ko@nyne.cloud`). Credentials in 1Password `twenty-stack`.

Cosmetic: Authentik's default `profile` scope puts full display name in `given_name`, leaves `family_name` empty — users edit in Twenty profile or an Authentik admin customizes the scope mapping.

## Follow-ups

- NYNE-216: group→role mapping
- SMTP setup (unfiled)
- `intranet-deploy` workflow comments still say "self-hosted runner doesn't exist yet" (stale) — clean up when wiring auto-deploy
