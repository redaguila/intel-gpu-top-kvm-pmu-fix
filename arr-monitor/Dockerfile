FROM node:22-alpine
ENV NODE_ENV=production PORT=8484 DATA_DIR=/config
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /config && chown node:node /config
USER node
VOLUME /config
EXPOSE 8484
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8484/api/health || exit 1
CMD ["node", "server/index.js"]
