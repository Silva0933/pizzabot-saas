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

# As VITE_* sao injetadas via build args (Coolify passa do painel)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PIZZABOT_API_URL
ARG VITE_EVOLUTION_API_URL
ARG VITE_EVOLUTION_API_KEY
ARG VITE_N8N_SECRETARIA_WEBHOOK_URL
ARG VITE_N8N_STATUS_WEBHOOK_URL
ARG VITE_N8N_PAYMENT_WEBHOOK_URL
ARG VITE_N8N_RAG_WEBHOOK_URL
ARG VITE_N8N_THANKS_WEBHOOK_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_PIZZABOT_API_URL=$VITE_PIZZABOT_API_URL \
    VITE_EVOLUTION_API_URL=$VITE_EVOLUTION_API_URL \
    VITE_EVOLUTION_API_KEY=$VITE_EVOLUTION_API_KEY \
    VITE_N8N_SECRETARIA_WEBHOOK_URL=$VITE_N8N_SECRETARIA_WEBHOOK_URL \
    VITE_N8N_STATUS_WEBHOOK_URL=$VITE_N8N_STATUS_WEBHOOK_URL \
    VITE_N8N_PAYMENT_WEBHOOK_URL=$VITE_N8N_PAYMENT_WEBHOOK_URL \
    VITE_N8N_RAG_WEBHOOK_URL=$VITE_N8N_RAG_WEBHOOK_URL \
    VITE_N8N_THANKS_WEBHOOK_URL=$VITE_N8N_THANKS_WEBHOOK_URL

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
