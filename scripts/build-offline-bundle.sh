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
out="release-tracker-images-$arch.tar.gz"

upstream="
public.ecr.aws/supabase/postgres:17.11.0.004
public.ecr.aws/supabase/gotrue:v2.197.0
public.ecr.aws/supabase/postgrest:v16.4
public.ecr.aws/supabase/realtime:v2.140.10
nginx:stable-alpine
"

echo "==> Pulling upstream images for $platform"
for image in $upstream; do
  docker pull --quiet --platform "$platform" "$image"
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
