const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FIFA World Cup 2026 API',
      version: '1.0.4',
      description: 'Complete REST API for FIFA World Cup 2026 - United States, Mexico & Canada'
    },
    // Server URL comes from API_URL so the "Try it out" button targets the
    // real host (e.g. the deployed API) instead of a hard-coded localhost.
    servers: [
      {
        url: process.env.API_URL || `http://localhost:${process.env.PORT || 3050}`,
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token'
        }
      },
      schemas: {
        User: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: {
              type: 'string',
              description: 'User full name'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            password: {
              type: 'string',
              format: 'password',
              description: 'User password (min 6 characters)'
            }
          }
        },
        Group: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'Group ID'
            },
            name: {
              type: 'string',
              description: 'Group name (A-L)'
            },
            winner: {
              type: 'string',
              description: 'Winner team'
            },
            runnerUp: {
              type: 'string',
              description: 'Runner-up team'
            }
          }
        },
        Team: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'Team ID'
            },
            name: {
              type: 'string',
              description: 'Team name'
            },
            flag: {
              type: 'string',
              description: 'Team flag URL'
            },
            group: {
              type: 'string',
              description: 'Group reference ID'
            },
            games: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of game IDs'
            }
          }
        },
        Game: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'MongoDB document ID'
            },
            id: {
              type: 'string',
              description: 'Public match ID (1-104)'
            },
            home_team_id: {
              type: 'string',
              description: 'Home team public ID'
            },
            away_team_id: {
              type: 'string',
              description: 'Away team public ID'
            },
            home_score: {
              type: 'string',
              description: 'Home team score'
            },
            away_score: {
              type: 'string',
              description: 'Away team score'
            },
            home_scorers: {
              type: 'string',
              description: 'Home team scorers list or null string'
            },
            away_scorers: {
              type: 'string',
              description: 'Away team scorers list or null string'
            },
            group: {
              type: 'string',
              description: 'Group/stage code (A-L, R32, R16, QF, SF, 3RD, FINAL)'
            },
            matchday: {
              type: 'string',
              description: 'Matchday number as string'
            },
            local_date: {
              type: 'string',
              description: 'Local date in MM/DD/YYYY HH:mm format'
            },
            persian_date: {
              type: 'string',
              description: 'Persian calendar date/time'
            },
            stadium_id: {
              type: 'string',
              description: 'Stadium public ID'
            },
            date: {
              type: 'string',
              format: 'date-time',
              description: 'Parsed game date/time (ISO)'
            },
            finished: {
              type: 'string',
              description: 'Match finished status (e.g. FALSE/TRUE)'
            },
            odds: {
              type: 'object',
              description: 'Live win/draw/win implied probabilities from Polymarket (whole-number percentages summing to 100). Absent until the updater has run.',
              properties: {
                home: { type: 'number', description: 'Home team win probability (%)' },
                draw: { type: 'number', description: 'Draw probability (%)' },
                away: { type: 'number', description: 'Away team win probability (%)' },
                source: { type: 'string', description: 'Odds source, e.g. "polymarket"' },
                slug: { type: 'string', description: 'Source Polymarket event slug' },
                updated_at: { type: 'string', format: 'date-time', description: 'When odds were last refreshed' }
              }
            },
            time_elapsed: {
              type: 'string',
              description: 'Match clock status (e.g. notstarted, 45, HT, FT)'
            },
            type: {
              type: 'string',
              description: 'Tournament stage type (group, r32, r16, qf, sf, third, final)'
            },
            home_team_label: {
              type: 'string',
              description: 'Placeholder label for knockout home side'
            },
            away_team_label: {
              type: 'string',
              description: 'Placeholder label for knockout away side'
            },
            homeTeam: {
              type: 'string',
              description: 'Internal MongoDB ObjectId reference to home team'
            },
            visitingTeam: {
              type: 'string',
              description: 'Internal MongoDB ObjectId reference to away team'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./controllers/*.js', './index.js']
};

const specs = swaggerJsdoc(options);

module.exports = { swaggerUi, specs };
