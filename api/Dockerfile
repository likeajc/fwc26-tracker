# FWC26 Tracker API — production image for Fly.io (Path B)
#
# Runs BOTH processes in one machine via PM2:
#   - fwc26-api      (Express REST API, index.js)
#   - fwc26-updater  (live scores + odds, scripts/auto-updater.js)
# See ecosystem.config.js for the process definitions.

FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install -g pm2 \
    && npm cache clean --force

# App source
COPY . .

EXPOSE 3050

# pm2-runtime keeps both processes alive in the foreground (Docker-friendly).
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
