# Build + run the 50 First Tapes MCP server over HTTP.
#
# Run-time config:
#   TAPES_BUNDLE     the bundle/vault to serve (mount a volume)
#   TAPES_KINDS      kind schemas (defaults to /app/spec/kinds)
#   TAPES_MCP_TOKEN  comma-separated Bearer tokens — REQUIRED for HTTP mode
#   TAPES_HTTP_PORT  listen port (default 8080)
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY spec ./spec
RUN pnpm install --frozen-lockfile && pnpm -r build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY --from=build /app ./
ENV TAPES_HTTP_PORT=8080
ENV TAPES_KINDS=/app/spec/kinds
EXPOSE 8080
CMD ["node", "packages/mcp/dist/index.js"]
