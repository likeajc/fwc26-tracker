const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Official FIFA World Cup 2026 squads (team name -> array of player names).
let squads = {};
try {
    squads = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/squads.json'), 'utf8'));
} catch (e) {
    console.error('squads.json could not be loaded:', e.message);
}

/**
 * @swagger
 * /get/squads:
 *   get:
 *     summary: Get all squads
 *     description: Official 26-player squads for all 48 teams, keyed by team name
 *     tags: [Squads]
 *     responses:
 *       200:
 *         description: Map of team name to list of player names
 */
router.get('/squads', (req, res) => {
    return res.status(200).json({ squads });
});

/**
 * @swagger
 * /get/squad/{team}:
 *   get:
 *     summary: Get a team's squad
 *     description: Official squad for one team, matched by English team name (case-insensitive)
 *     tags: [Squads]
 *     parameters:
 *       - in: path
 *         name: team
 *         required: true
 *         schema:
 *           type: string
 *         description: Team name (e.g. Brazil)
 *     responses:
 *       200:
 *         description: Team name and its list of players
 *       404:
 *         description: No squad found for the given team
 */
router.get('/squad/:team', (req, res) => {
    const q = decodeURIComponent(req.params.team).trim().toLowerCase();
    const key = Object.keys(squads).find(k => k.toLowerCase() === q);
    if (!key) {
        return res.status(404).json({ error: `No squad found for team: ${req.params.team}` });
    }
    return res.status(200).json({ team: key, players: squads[key] });
});

module.exports = app => app.use('/get', router);
