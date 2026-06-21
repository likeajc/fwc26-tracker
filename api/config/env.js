const path = require('path');
const dotenv = require('dotenv');

let configLoaded = false;
let config = null;

// Load environment configuration
function loadEnvConfig() {
  if (configLoaded) return config;

  const NODE_ENV = (process.env.NODE_ENV || 'development').trim();

  // Load the matching env file
  const envFile = NODE_ENV === 'production' ? '.env.production' : '.env.development';
  const envPath = path.resolve(process.cwd(), envFile);

  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.warn(`${envFile} not found, falling back to defaults`);
    dotenv.config();
  }

  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`📁 Env file: ${envFile}`);

  config = {
    // Environment
    NODE_ENV,
    isDev: NODE_ENV === 'development',
    isProd: NODE_ENV === 'production',
    isDevelopment: NODE_ENV === 'development',
    isProduction: NODE_ENV === 'production',

    // Server
    PORT: parseInt(process.env.PORT) || 3050,
    API_URL: process.env.API_URL || `http://localhost:${process.env.PORT || 3050}`,
    FRONTEND_URL: process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3050}`,

    // Database
    MONGODB_URL: process.env.MONGODB_URL || 'mongodb://localhost:27017/worldcup2026',

    // Security
    JWT_SECRET: process.env.JWT_SECRET || 'worldcup2026_dev_secret_key',
    SECRET: process.env.SECRET || 'worldcup2026_secret',
    ACCESSCODEDEV: process.env.ACCESSCODEDEV || 'devcode123',

    // Rate Limiting
    RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
    RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 500,

    // CORS
    CORS_ORIGINS: process.env.CORS_ORIGINS || '*',

    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'error' : 'debug'),

    // Swagger
    ENABLE_SWAGGER: process.env.ENABLE_SWAGGER === 'true' || NODE_ENV === 'development',

    // Resolve CORS origins
    getCorsOrigins: function () {
      const origins = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '*';
      if (origins === '*') return '*';
      return origins.split(',').map(o => o.trim());
    }
  };

  configLoaded = true;
  return config;
}

// Export both function and config object
module.exports = { loadEnvConfig, config: null };

// Getter for config to ensure it's loaded
Object.defineProperty(module.exports, 'config', {
  get: function () {
    if (!config) loadEnvConfig();
    return config;
  }
});
