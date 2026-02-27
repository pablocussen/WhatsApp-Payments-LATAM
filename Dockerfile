FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY docs/ ./docs/
RUN npx prisma generate --schema=src/models/schema.prisma
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -g 1001 -S whatpay && adduser -S whatpay -u 1001

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docs ./docs

USER whatpay
EXPOSE 3000
CMD ["node", "dist/api/server.js"]
