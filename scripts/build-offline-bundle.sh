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
public.ecr.aws/supabase/postgres:17.11.0.004
public.ecr.aws/supabase/gotrue:v2.197.0
public.ecr.aws/supabase/postgrest:v16.4
public.ecr.aws/supabase/realtime:v2.140.10
nginx:stable-alpine
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

# Build for both platforms so the tags keep working on this machine too.
host="linux/$(docker version --format '{{.Server.Arch}}')"
platforms="$platform"
[ "$host" = "$platform" ] || platforms="$platform,$host"

echo "==> Building app images for $platforms"
docker buildx build --platform "$platforms" --load -t release-tracker-db ./docker/db
docker buildx build --platform "$platforms" --load -t release-tracker-migrate -f docker/migrate/Dockerfile .
docker buildx build --platform "$platforms" --load -t release-tracker-web \
  --build-arg VITE_SUPABASE_URL=same-origin \
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InJlbGVhc2UtdHJhY2tlci1sb2NhbCIsImlhdCI6MTc5MTgzMDMyMiwiZXhwIjoyMTA3MTkwMzIyfQ.sPUkA3JqAPh29hCjjo-BzGNPmZE96NEYoL_9Ut9Y_WQ}" \
  .

echo "==> Saving $out"
docker save --platform "$platform" \
  release-tracker-db release-tracker-migrate release-tracker-web \
  public.ecr.aws/supabase/gotrue:v2.197.0 \
  public.ecr.aws/supabase/postgrest:v16.4 \
  public.ecr.aws/supabase/realtime:v2.140.10 \
  | gzip -6 > "$out"

ls -lh "$out"
echo "Done. Copy $out together with the project folder."
