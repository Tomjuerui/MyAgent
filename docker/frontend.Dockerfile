# ============================================================
# ERP Agent 前端镜像（Next.js 16 standalone 产物）
# 构建上下文为 frontend/
# ============================================================
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 本地开发阶段：只备好 node_modules，源码由 docker-compose.override.yml
# 以 ./frontend:/app 绑定挂载，`next dev` 提供 Fast Refresh。
# 注意：/app/node_modules 在 compose 里被命名卷覆盖（首次从本阶段镜像内容初始化），
# 避免宿主 Windows 的原生模块（lightningcss/sharp 等）污染容器。
FROM node:22-alpine AS dev
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
