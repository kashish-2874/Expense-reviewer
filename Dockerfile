# Single container: the Express server serves both the API and the built UI.

FROM node:22-slim AS build
WORKDIR /app
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
ENV NODE_ENV=production PORT=3001 DB_PATH=/data/expense-review.db
WORKDIR /app
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
# SQLite file lives on a volume so claims and the audit log survive restarts.
# Created and owned by the unprivileged user the server runs as.
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server.js"]
