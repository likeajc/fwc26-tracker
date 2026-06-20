// PM2 process manager configuration.
// Runs the API and the live updater as managed, auto-restarting services.
//
//   npm run pm:start     # start both
//   npm run pm:logs      # tail logs
//   npm run pm:stop      # stop both
//
// Configure secrets/connection via the environment or a .env file (see
// .env.example); do not put credentials here.
module.exports = {
  apps: [
    {
      name: "fwc26-api",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "fwc26-updater",
      script: "scripts/auto-updater.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      // The updater self-polls every POLL_INTERVAL ms; PM2 keeps it alive and
      // restarts it (with a short backoff) if it ever crashes.
      restart_delay: 5000,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production", POLL_INTERVAL: "3000" },
    },
  ],
};
