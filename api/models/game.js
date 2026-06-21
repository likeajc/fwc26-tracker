const mongoose = require('../database');

const GameSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true
    },
    home_team_id: {
        type: String,
        required: true
    },
    away_team_id: {
        type: String,
        required: true
    },
    home_score: {
        type: String,
        default: "0"
    },
    away_score: {
        type: String,
        default: "0"
    },
    home_scorers: {
        type: String,
        default: "null"
    },
    away_scorers: {
        type: String,
        default: "null"
    },
    group: {
        type: String
    },
    matchday: {
        type: String
    },
    local_date: {
        type: String
    },
    persian_date: {
        type: String
    },
    stadium_id: {
        type: String,
        required: true
    },
    finished: {
        type: String,
        default: "FALSE"
    },
    time_elapsed: {
        type: String,
        default: "notstarted"
    },
    type: {
        type: String,
        default: "group"
    },
    home_team_label: {
        type: String,
        default: ""
    },
    away_team_label: {
        type: String,
        default: ""
    },
    // Live win/draw/win implied probabilities — whole-number percentages that
    // always sum to exactly 100 — sourced from Polymarket's per-match 3-way
    // markets. See scripts/polymarket-odds.js. Absent until the updater has run.
    odds: {
        home: { type: Number },        // home team win probability (%)
        draw: { type: Number },        // draw probability (%)
        away: { type: Number },        // away team win probability (%)
        source: { type: String },      // e.g. "polymarket"
        slug: { type: String },        // source Polymarket event slug
        updated_at: { type: Date }     // when these odds were last refreshed
    },
    homeTeam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team'
    },
    visitingTeam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team'
    },
    date: {
        type: Date,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Game = mongoose.model('Game', GameSchema);

module.exports = Game;