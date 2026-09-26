# ============================================================
# Stage 1: Build do Vite/React
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copia manifests primeiro pra aproveitar cache de layer
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Copia o resto e builda
COPY . .

# As VITE_* sao injetadas via build args (Coolify passa do painel).
# ATENCAO: toda VITE_* vai em texto claro no bundle publico. Nunca declarar aqui
# chave/token (a antiga VITE_EVOLUTION_API_KEY daria controle das instancias de
# WhatsApp a quem abrisse o JS). Supabase e n8n nao sao mais usados pelo painel.
ARG VITE_PIZZABOT_API_URL

ENV VITE_PIZZABOT_API_URL=$VITE_PIZZABOT_API_URL

RUN npm run build

# ============================================================
# Stage 2: Nginx servindo o dist
# ============================================================
FROM nginx:alpine

# curl pro HEALTHCHECK (não vem por default no nginx:alpine novo)
RUN apk add --no-cache curl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
