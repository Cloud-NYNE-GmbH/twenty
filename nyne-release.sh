#!/usr/bin/env bash
#
# NYNE Twenty fork — local build & publish of the custom image.
#
# We don't build in CI (the twenty-front build is memory-heavy and we iterate
# rarely), so the image is built and pushed from a workstation. The intranet
# LXC is amd64, so we ALWAYS build for linux/amd64 — building natively on an
# Apple-Silicon Mac would produce an arm64 image the server can't run.
#
# Usage:
#   ./nyne-release.sh              # tag = current git short SHA (+ :latest)
#   ./nyne-release.sh v2.8.3-nyne1 # explicit tag (+ :latest)
#
# Prerequisites:
#   - Node 24 (the repo requires ^24.5.0) and deps installed (`yarn install`)
#   - docker buildx available (Docker Desktop has it)
#   - logged in to GHCR:  echo "$GHCR_TOKEN" | docker login ghcr.io -u <user> --password-stdin
#     (token needs write:packages)
#
# Why we pre-build the frontend on the host: twenty-front's build needs ~8 GB
# and OOMs inside Docker Desktop's VM ("cannot allocate memory"). Built natively
# it uses the host's full RAM + swap. The output (static assets) is
# architecture-independent, so an arm64 Mac still produces a valid amd64 image —
# only the server runtime is arch-specific, and that's installed in the image.
# The Dockerfile detects packages/twenty-front/build/ and skips its own build.
#
# After pushing, deploy by pinning the tag in intranet-deploy:
#   - set TWENTY_TAG=<tag> in the LXC's twenty/.env, then `make up STACK=twenty`
#   - (or trigger the intranet-deploy deploy-stack workflow with {stack:twenty, tag:<tag>})

set -euo pipefail

REGISTRY="ghcr.io"
IMAGE="${REGISTRY}/cloud-nyne-gmbh/twenty"
PLATFORM="linux/amd64"

cd "$(dirname "$0")"

TAG="${1:-$(git rev-parse --short HEAD)}"

# Node 24 is required (engines: ^24.5.0). If the active node isn't 24, try to
# pick up a Homebrew node@24 automatically; otherwise warn and continue.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" != "24" ]; then
  for nm in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
    if [ -x "$nm/node" ]; then
      export PATH="$nm:$PATH"
      echo "Using Node $("$nm/node" -p 'process.versions.node') from $nm."
      NODE_MAJOR=24
      break
    fi
  done
fi
if [ "$NODE_MAJOR" != "24" ]; then
  echo "WARNING: Node ${NODE_MAJOR}.x detected — this repo targets Node 24 (^24.5.0)." >&2
  echo "         If the build misbehaves: brew install node@24." >&2
fi

# nx shells out to 'yarn build' internally. If no global yarn/corepack is set
# up, bootstrap a shim pointing at the Yarn 4 release pinned in .yarn/releases,
# so this script works without any global toolchain fiddling.
if ! command -v yarn >/dev/null 2>&1; then
  YARN_RELEASE="$(ls "$PWD"/.yarn/releases/yarn-*.cjs 2>/dev/null | head -1)"
  if [ -z "$YARN_RELEASE" ]; then
    echo "ERROR: no global 'yarn' and no .yarn/releases/yarn-*.cjs to bootstrap from." >&2
    exit 1
  fi
  SHIM_DIR="$(mktemp -d)"
  trap 'rm -rf "$SHIM_DIR"' EXIT
  printf '#!/bin/sh\nexec node "%s" "$@"\n' "$YARN_RELEASE" > "$SHIM_DIR/yarn"
  chmod +x "$SHIM_DIR/yarn"
  export PATH="$SHIM_DIR:$PATH"
  echo "Using bundled Yarn ($(basename "$YARN_RELEASE")) via shim."
fi

# 1) Build the frontend natively on the host (avoids Docker's memory cap).
echo "Pre-building twenty-front on the host…"
NODE_OPTIONS="--max-old-space-size=8192" npx nx build twenty-front

if [ ! -d packages/twenty-front/build ]; then
  echo "ERROR: packages/twenty-front/build was not produced; aborting." >&2
  exit 1
fi

# 2) Build the image. The Dockerfile detects the pre-built front and skips its
#    own (OOM-prone) frontend build.
echo "Building ${IMAGE}:${TAG} for ${PLATFORM} (also tagging :latest)…"

# IMPORTANT: build the `twenty` stage explicitly. The Dockerfile's LAST stage
# is `twenty-app-dev` — an all-in-one dev image that embeds Postgres+Redis+s6
# and reaches for a `default` DB on localhost. Without --target, buildx picks
# that stage and the result is a container that cannot talk to our external
# twenty-db. The `twenty` stage is server+frontend, no embedded services, uses
# PG_DATABASE_URL via /app/entrypoint.sh — what our compose actually expects.
docker buildx build \
  --platform "${PLATFORM}" \
  -f packages/twenty-docker/twenty/Dockerfile \
  --target twenty \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  --push \
  .

echo
echo "Pushed:"
echo "  ${IMAGE}:${TAG}"
echo "  ${IMAGE}:latest"
echo
echo "Deploy: set TWENTY_TAG=${TAG} in the LXC twenty/.env and run 'make up STACK=twenty'."
