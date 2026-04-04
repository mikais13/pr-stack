FROM oven/bun:1.3.9-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/

RUN bun install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY apps/api/ ./apps/api/
COPY packages/core/ ./packages/core/

WORKDIR /app/apps/api
RUN bun build src/server.ts --outfile=dist/server.js --target=bun

FROM oven/bun:1.3.9-alpine

# git is required for clone/rebase operations in git.service.ts
RUN apk add --no-cache git

WORKDIR /app

COPY --from=build /app/apps/api/dist/server.js ./server.js

EXPOSE 8080

CMD ["bun", "run", "server.js"]
