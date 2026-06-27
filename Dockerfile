# EYE Agência — Backend (Fastify + node:sqlite, sem binários nativos)
# Node 22+ traz o SQLite embutido (node:sqlite) e o type-stripping de TS.
FROM node:22-alpine

WORKDIR /app

# dependências (apenas runtime — tudo JS puro)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# código
COPY . .

ENV NODE_ENV=production
ENV PORT=3333
ENV DATABASE_URL=file:./data/eye.db
ENV UPLOAD_DIR=./data/uploads

# dados persistentes (banco + uploads) ficam em /app/data → monte um volume
RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]

EXPOSE 3333

# aplica o schema na subida (o server faz applySchema) e inicia
CMD ["node", "--experimental-strip-types", "--experimental-sqlite", "src/server.ts"]
