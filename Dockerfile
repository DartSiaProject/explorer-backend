# Build Stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY nx.json tsconfig.base.json ./

# Install dependencies (including dev dependencies for build)
RUN npm install --legacy-peer-deps

# Copy all source code
COPY . .

# Build all apps
RUN npx nx run-many --target=build --all --prod

# Production Runtime (Unified Image)
FROM node:18-alpine
WORKDIR /app

# Copy all built apps
COPY --from=build /app/dist ./dist

# Copy package files
COPY --from=build /app/package*.json ./

# Install production dependencies
RUN npm install --production --legacy-peer-deps

# Default command (can be overridden by docker-compose)
CMD ["node", "dist/apps/gateway/main.js"]
