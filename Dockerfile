# Build Stage
FROM node:18 AS build

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY nx.json tsconfig.base.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy all source code
COPY . .

# Build all apps
ENV NX_DAEMON=false
ENV CI=true
RUN npx nx reset
RUN npx nx run-many --target=build --all --prod --verbose

# Production Runtime (Unified Image)
FROM node:18-alpine
WORKDIR /app

# Install runtime dependencies for healthcheck
RUN apk add --no-cache wget

# Copy all built apps
COPY --from=build /app/dist ./dist

# Copy package files
COPY --from=build /app/package*.json ./

# Install production dependencies
RUN npm install --production --legacy-peer-deps

# Default command
CMD ["node", "dist/apps/gateway/main.js"]
