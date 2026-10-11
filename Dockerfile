# Single container: the Express server serves both the API and the built UI.
# Data lives in MongoDB (e.g. Atlas), so the container itself is stateless.
#
# Required at runtime (pass with -e or your host's settings):
#   MONGODB_URI     replica set / Atlas connection string (transactions are required)
#   JWT_SECRET      long random string; the server refuses to start without it
#   ADMIN_USERNAME  admin account created on first start if it does not exist
#   ADMIN_PASSWORD
# Optional: MONGODB_DB, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, AI_TIMEOUT_MS, LOG_LEVEL

FROM node:22-slim AS build
WORKDIR /app
# mongodb-memory-server is a test-only dependency that downloads a MongoDB
# binary when installed. The image never runs tests, so skip the download.
ENV MONGOMS_DISABLE_POSTINSTALL=1
# Install dependencies first so they are cached until a lockfile changes.
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY client/package.json client/package-lock.json client/
RUN cd client && npm ci
COPY server server
COPY client client
RUN cd client && npm run build \
 && cd ../server && npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
EXPOSE 3001
USER node
# /api/health also pings MongoDB, so an unreachable database marks the container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server.js"]
