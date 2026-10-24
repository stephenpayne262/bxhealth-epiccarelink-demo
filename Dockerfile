FROM node:24-alpine AS check
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server.js index.html ./
RUN node --check server.js

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3010
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
	&& npm cache clean --force \
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
	&& rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --chown=node:node server.js index.html ./
USER node
EXPOSE 3010
CMD ["node", "server.js"]