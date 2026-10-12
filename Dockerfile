# check=skip=SecretsUsedInArgOrEnv
# (The only "key" here is the Supabase anon/publishable key: public by design,
# it ships inside the browser bundle. Never pass a service-role key.)
# Release Tracker web image: builds the SPA, serves it with nginx, and routes
# the Supabase APIs of the local stack (see docker-compose.yml).

# The build output is plain JS/CSS, identical on every CPU, so build on the
# builder's native platform even when the image targets another one.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skips the Supabase CLI binary download (not needed to build).
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG VITE_SUPABASE_URL=same-origin
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" || (echo 'VITE_SUPABASE_PUBLISHABLE_KEY build arg is required' && exit 1)
RUN npm run build

FROM nginx:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q --spider http://127.0.0.1/ || exit 1
