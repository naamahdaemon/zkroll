FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace @zkroll/shared
RUN npm run build --workspace @zkroll/contracts
RUN npm run build --workspace @zkroll/api

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages

EXPOSE 4000
EXPOSE 4001
CMD ["node", "apps/api/dist/server.js"]
