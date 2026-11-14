FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node cloud-server.mjs ./
COPY --chown=node:node public ./public
USER node
CMD ["node", "cloud-server.mjs"]
