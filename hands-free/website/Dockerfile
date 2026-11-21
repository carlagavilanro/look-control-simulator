FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node cloud-server.mjs hub.mjs fan-signals.json ./
COPY --chown=node:node public ./public
# Devices, buttons and board links are kept in DATA_DIR, or in the volume Railway attaches
# (RAILWAY_VOLUME_MOUNT_PATH). A Railway volume belongs to root: set RAILWAY_RUN_UID=0 there.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "cloud-server.mjs"]
