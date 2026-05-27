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
#   - docker buildx available (Docker Desktop has it)
#   - logged in to GHCR:  echo "$GHCR_TOKEN" | docker login ghcr.io -u <user> --password-stdin
#     (token needs write:packages)
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

echo "Building ${IMAGE}:${TAG} for ${PLATFORM} (also tagging :latest)…"

docker buildx build \
  --platform "${PLATFORM}" \
  -f packages/twenty-docker/twenty/Dockerfile \
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
