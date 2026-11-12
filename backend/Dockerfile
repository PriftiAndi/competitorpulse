FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY package.json ./
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/index.js"]
