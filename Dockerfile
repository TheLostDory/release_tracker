# Release Tracker: one image with the Express API and the built frontend.
#
#   build  : compile the SPA (vite) and the server (tsc), then drop dev deps
#   runtime: node + production deps + compiled output + SQL migrations
#
# The build stage runs on the builder's native CPU: the output (JS/CSS and
# pure-JS server deps) is CPU-independent, so cross-CPU images need no emulation.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: no install scripts are needed to build.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/db ./server/db
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist-server/server/index.js"]
