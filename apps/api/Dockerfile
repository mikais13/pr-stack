FROM oven/bun:1.3.9-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN bun build src/server.ts --outfile=dist/server.js --target=bun

FROM oven/bun:1.3.9-alpine

# git is required for clone/rebase operations in git.service.ts
RUN apk add --no-cache git

WORKDIR /app

COPY --from=build /app/dist/server.js ./server.js

EXPOSE 8080

CMD ["bun", "run", "server.js"]
