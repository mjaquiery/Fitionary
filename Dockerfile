# syntax=docker/dockerfile:1

# Empty by default. To build without network access to GitHub, point it at a
# local clone of free-exercise-db:
#   docker build --build-context free-exercise-db=../free-exercise-db .
FROM scratch AS free-exercise-db

# ---- Build: install deps, fetch the exercise images, bundle the app ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Images (~100 MB) are not committed. Fetch them before copying the rest of
# the source so this layer stays cached until the data or the script changes.
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src/constants.ts src/types.ts ./src/
COPY src/data ./src/data
RUN --mount=type=bind,from=free-exercise-db,target=/free-exercise-db \
    if [ -f /free-exercise-db/dist/exercises.json ]; then \
      npm run fetch-data -- --images-only --source /free-exercise-db; \
    else \
      npm run fetch-data -- --images-only; \
    fi

COPY . .
RUN npm run build

# ---- Serve: static files with Caddy ----
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
