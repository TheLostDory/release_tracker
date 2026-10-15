#!/bin/sh
# Builds a self-contained image bundle so another machine can run the Docker
# stack WITHOUT internet access (no image pulls, no npm install).
#
#   scripts/build-offline-bundle.sh amd64   # Windows PCs, Intel Macs
#   scripts/build-offline-bundle.sh arm64   # Apple-silicon Macs (M1 and later)
#
# Output: release-tracker-images-<arch>.tar.gz in the current directory.
# On the target machine (inside the project folder):
#   docker load -i release-tracker-images-<arch>.tar.gz
#   docker compose up -d          # no --build: uses the loaded images
#
# Requires Docker with the containerd image store (Docker Desktop default),
# which keeps several platforms of the same image side by side, so this
# doesn't disturb the images your local stack runs on.
set -eu

arch="${1:?usage: build-offline-bundle.sh amd64|arm64}"
case "$arch" in
  amd64 | arm64) ;;
  *) echo "arch must be amd64 or arm64" >&2; exit 1 ;;
esac
platform="linux/$arch"
# Bundle goes to the directory you run this from; builds run from the repo root.
out="$(pwd)/release-tracker-images-$arch.tar.gz"
cd "$(dirname "$0")/.."

upstream="
postgres:17-alpine
node:22-alpine
"

# Retries: large layers over flaky connections can drop mid-download.
# Completed layers are kept, so each retry resumes.
pull() {
  for attempt in 1 2 3 4 5; do
    if docker pull --quiet --platform "$platform" "$1"; then return 0; fi
    echo "    pull failed (attempt $attempt), retrying in 10s…" >&2
    sleep 10
  done
  echo "Could not download $1. Check the connection and run again." >&2
  return 1
}

echo "==> Pulling upstream images for $platform"
for image in $upstream; do
  pull "$image"
done

# Build for both platforms so the tag keeps working on this machine too.
host="linux/$(docker version --format '{{.Server.Arch}}')"
platforms="$platform"
[ "$host" = "$platform" ] || platforms="$platform,$host"

echo "==> Building the app image for $platforms"
docker buildx build --platform "$platforms" --load -t release-tracker-app .

echo "==> Saving $out"
docker save --platform "$platform" release-tracker-app postgres:17-alpine | gzip -6 > "$out"

ls -lh "$out"
echo "Done. Copy $out together with the project folder."
