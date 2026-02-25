FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Build
FROM base AS builder
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production
FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 -S whatpay && adduser -S whatpay -u 1001
COPY --from=base /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER whatpay
EXPOSE 3000
CMD ["node", "dist/api/server.js"]
