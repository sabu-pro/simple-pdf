FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY scripts/copy-pdf-assets.mjs ./scripts/copy-pdf-assets.mjs
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu fonts-liberation python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY requirements-conversion.txt /tmp/requirements-conversion.txt
RUN python3 -m venv /opt/simplepdf-conversion && /opt/simplepdf-conversion/bin/pip install --no-cache-dir -r /tmp/requirements-conversion.txt && rm /tmp/requirements-conversion.txt
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOME=/tmp/simplepdf-home PYTHON_PATH=/opt/simplepdf-conversion/bin/python
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
