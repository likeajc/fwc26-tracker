// Load environment configuration
const { loadEnvConfig, config } = require('./config/env');
loadEnvConfig();

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');

// Catch unhandled errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    console.error(err.stack);
});

const app = express();
const PORT = config.PORT;

// Trust proxy - MUST be set when behind nginx/reverse proxy
app.set('trust proxy', 1);

// Swagger setup (only in development or if explicitly enabled)
let swaggerUi, specs;
if (config.ENABLE_SWAGGER) {
    try {
        const swagger = require('./swagger');
        swaggerUi = swagger.swaggerUi;
        specs = swagger.specs;
        console.log('Swagger loaded');
    } catch (err) {
        console.error('Swagger failed to load:', err.message);
    }
} else {
    console.log('Swagger is disabled');
}

// CORS - public read endpoints must be reachable from browsers on other origins
const corsOrigins = config.getCorsOrigins();
const publicCorsOptions = {
    origin: '*',
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false
};
const privateCorsOptions = {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
};

app.use((req, res, next) => {
    if (req.path.startsWith('/get')) {
        return cors(publicCorsOptions)(req, res, next);
    }
    return cors(privateCorsOptions)(req, res, next);
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// Compression for faster responses
app.use(compression());

// Rate limiting - configurable per environment
const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW,
    max: config.RATE_LIMIT_MAX,
    message: {
        error: 'Too many requests, please try again later.',
        retryAfter: '1 second'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
});
app.use(limiter);

// Logging
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));

console.log(`🌍 Environment: ${config.NODE_ENV}`);
console.log(`📊 Rate Limit: ${config.RATE_LIMIT_MAX} req/${config.RATE_LIMIT_WINDOW}ms`);
console.log(`🔗 CORS Origin: ${typeof corsOrigins === 'string' ? corsOrigins : corsOrigins.join(', ')}`);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '10kb' })); // Limit body size

// Swagger Documentation
if (swaggerUi && specs) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'FIFA World Cup 2026 API Documentation'
    }));
    console.log('📚 Swagger UI available at /api-docs');
}

/**
 * @swagger
 * /:
 *   get:
 *     summary: Welcome endpoint
 *     description: Returns API welcome message
 *     tags: [General]
 *     security: []
 *     responses:
 *       200:
 *         description: Welcome message
 */
app.get('/', (req, res) => {
    // When the docs are enabled, the root is the human-facing entry point:
    // send visitors straight to the interactive Swagger UI.
    if (config.ENABLE_SWAGGER) {
        return res.redirect('/api-docs');
    }
    res.send({
        message: 'FIFA World Cup 2026 API',
        endpoints: ['/get/teams', '/get/groups', '/get/games', '/get/stadiums']
    });
});

require('./controllers/index')(app);

app.use((req, res, next) => {
    const erro = new Error('Route not found');
    erro.status = 404;
    next(erro);
});

app.use((error, req, res, next) => {
    console.error(`Error ${error.status || 500}: ${error.message} | ${req.method} ${req.url}`);
    res.status(error.status || 500);
    return res.send({
        error: {
            message: error.message
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
