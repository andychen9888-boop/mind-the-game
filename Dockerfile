# Mind the Game: static player + AI explain API. No npm dependencies.
# Secrets are passed at runtime (e.g. Azure Container Apps secrets → env vars), never baked in.
FROM node:22-alpine
WORKDIR /srv
COPY package.json ./
COPY app ./app
COPY server ./server
COPY scripts ./scripts
COPY data/cases ./data/cases
COPY data/synthetic ./data/synthetic
ENV HOST=0.0.0.0 PORT=8000 NODE_ENV=production
USER node
EXPOSE 8000
CMD ["node", "server/server.cjs"]
