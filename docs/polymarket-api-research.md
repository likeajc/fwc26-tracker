# Polymarket API — Research & Integration Reference

> Research compiled 2026-06-21 for the **FWC26 Tracker**. Purpose: evaluate and
> document how to pull Polymarket prediction-market odds (World Cup winner,
> group winners, match outcomes) into the Node.js/Express backend as a
> **read-only** data source.
>
> **Bottom line:** Everything we need is **public, unauthenticated REST**. Use
> the **Gamma API** for market/event discovery + token IDs, and the **CLOB API**
> for live prices. No wallet, no API key, no signing required for reads. Reading
> data is not geoblocked (only *trading* is). Recommended approach: plain
> `fetch`/`axios` against the REST endpoints — skip the SDK.

---

## 1. The three public API surfaces

Polymarket exposes three separate services, all sitting on top of its smart
contracts on Polygon (chainId **137**). For a read-only odds tracker we only
need the first two.

| Service | Base URL | Purpose | Auth |
|---|---|---|---|
| **Gamma API** | `https://gamma-api.polymarket.com` | Market/event **discovery** & metadata (titles, dates, volume, liquidity, tags, **CLOB token IDs**) | **None** |
| **CLOB API** | `https://clob.polymarket.com` | Order book / **live prices** / price history / midpoints / spreads | **None for reads**; L1/L2 only for trading |
| **Data API** | `https://data-api.polymarket.com` | User analytics: positions, trades, activity, holders, value | **None** (but mostly user-scoped) |

There is also a **WebSocket** service (`wss://ws-subscriptions-clob.polymarket.com/ws/`)
and (now-deprecated) **subgraphs**. Details in §6 and §9.

Sources: [Gamma overview](https://docs.polymarket.com/developers/gamma-markets-api/overview),
[CLOB intro](https://docs.polymarket.com/developers/CLOB/introduction),
[API intro](https://docs.polymarket.com/api-reference/introduction).

---

## 2. Gamma API — discovery & metadata (read-only, no auth)

Base: `https://gamma-api.polymarket.com`. Every endpoint is a public GET.

### Key endpoints

| Endpoint | Returns |
|---|---|
| `GET /markets` | List of market objects (filter + paginate) |
| `GET /markets/{id}` | Single market by numeric ID |
| `GET /markets/slug/{slug}` | Single market by slug |
| `GET /events` | List of events (each wraps a `markets[]` array) |
| `GET /events/{id}` | Single event by numeric ID |
| `GET /events/slug/{slug}` | Single event by slug |
| `GET /tags`, `GET /tags/slug/{slug}` | Categories (Sports, Soccer, World Cup…) |
| `GET /sports` | Per-sport metadata (tag IDs, series IDs, resolution sources) |
| `GET /public-search` | Search across events, markets, profiles |
| `GET /series` | Recurring/grouped events (e.g. leagues) |

### Common query params

- **Pagination/sort (all list endpoints):** `limit`, `offset`, `order`
  (comma-separated fields), `ascending` (bool, default `false` = descending).
- **`/markets` filters:** `active`, `closed` (default `false`), `archived`;
  array filters `id`, `slug`, `clob_token_ids`, `condition_ids`,
  `question_ids`; ranges `liquidity_num_min/max`, `volume_num_min/max`,
  `start_date_min/max`, `end_date_min/max`; tags `tag_id`, `related_tags`,
  `include_tag`; `enableOrderBook` (filter to CLOB-tradable markets).
- **`/events` filters:** same idea but range params drop the `_num`
  (`liquidity_min/max`, `volume_min/max`); plus `featured`, `tag_slug`,
  `exclude_tag_id`. `order` accepts `volume24hr`, `volume`, `liquidity`,
  `start_date`, `end_date`, `competitive`, `closed_time`.

> ⚠️ **Param-name mismatch:** markets use `volume_num_min`/`liquidity_num_min`;
> events use `volume_min`/`liquidity_min`.

### Market object — important fields

`id`, `question`, `conditionId`, `questionID`, `slug`, `groupItemTitle`
(e.g. the team name in a multi-team event), `outcomes`, `outcomePrices`,
`clobTokenIds`, `lastTradePrice`, `bestBid`, `bestAsk`, `spread`, `volume`,
`volumeNum`, `liquidity`, `volume24hr`, `active`, `closed`, `archived`,
`startDate`, `endDate`, `enableOrderBook`, `orderPriceMinTickSize`,
`orderMinSize`.

### Event object — important fields

`id`, `ticker`, `slug`, `title`, `description`, `active`, `closed`,
`startDate`, `endDate`, `liquidity`, `volume`, `volume24hr`, `negRisk`,
`enableOrderBook`, and **`markets`** (array of full market objects), `series`,
`tags`.

### ⚠️ The #1 gotcha: stringified arrays

`outcomes`, `outcomePrices`, and `clobTokenIds` come back as **JSON-encoded
strings**, not native arrays. You must parse them:

```js
const outcomes  = JSON.parse(market.outcomes);     // ["Yes","No"]
const prices    = JSON.parse(market.outcomePrices); // ["0.1365","0.8635"]
const tokenIds  = JSON.parse(market.clobTokenIds);  // ["4394...","1126..."]
```

The three arrays are **index-aligned**: index `0` = **Yes** (token + price),
index `1` = **No**. Also send a real `User-Agent` header to avoid intermittent
blocking.

### Example

```bash
curl "https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr&ascending=false&limit=20"
curl "https://gamma-api.polymarket.com/events?slug=world-cup-winner"
curl "https://gamma-api.polymarket.com/markets?slug=will-spain-win-the-2026-fifa-world-cup"
```

Sources: [Gamma overview](https://docs.polymarket.com/developers/gamma-markets-api/overview),
[Gamma structure](https://docs.polymarket.com/developers/gamma-markets-api/gamma-structure),
[list-markets](https://docs.polymarket.com/api-reference/markets/list-markets),
[list-events](https://docs.polymarket.com/api-reference/events/list-events),
[fetch-markets guide](https://docs.polymarket.com/developers/gamma-markets-api/fetch-markets-guide).

---

## 3. CLOB API — live prices (read-only, no auth)

Base: `https://clob.polymarket.com`. These "L0" market-data endpoints need **no
authentication**.

| Endpoint | Method | Params | Response |
|---|---|---|---|
| `/price` | GET | `token_id`, `side`=`BUY`\|`SELL` | `{"price": 0.45}` |
| `/prices` | POST | body `[{token_id, side}]` | batch |
| `/midpoint` | GET | `token_id` | `{"mid": "0.50"}` |
| `/midpoints` | POST | body `[{token_id}]` | batch (~500 max) |
| `/book` | GET | `token_id` | `{bids:[{price,size}], asks:[...], tick_size, ...}` |
| `/books` | POST | body `[{token_id}]` | batch |
| `/spread` | GET | `token_id` | `{"spread": "0.04"}` |
| `/spreads` | POST | body `[{token_id}]` | batch |
| `/prices-history` | GET | see below | `{"history":[{"t":..,"p":..}]}` |
| `/last-trade-price` | GET | `token_id` | public last trade |
| `/markets`, `/sampling-markets` | GET | `next_cursor` | paginated markets |

> ⚠️ `side` describes the **order-book side**, not your action: `side=BUY`
> returns the best **ask**, `side=SELL` returns the best **bid**. In `/book`
> arrays the **best price is at the tail** (`arr[length-1]`), not index 0.
> Field types are inconsistent — `/price` returns a number, `/midpoint` and
> `/spread` return strings. Parse defensively.

### `/prices-history` (historical series)

- `market` — **required**, the **clobTokenId** (ERC-1155 token id), *not* the
  conditionId.
- `interval` — one of `max`, `all`, `1m`, `1w`, `1d`, `6h`, `1h` …**or** use a
  custom `startTs`+`endTs` (unix seconds).
- `fidelity` — resolution in minutes (default 1).

```bash
curl "https://clob.polymarket.com/price?token_id=TOKEN_ID&side=BUY"
curl "https://clob.polymarket.com/midpoint?token_id=TOKEN_ID"
curl "https://clob.polymarket.com/book?token_id=TOKEN_ID"
curl "https://clob.polymarket.com/prices-history?market=TOKEN_ID&interval=1d&fidelity=5"
```

Sources: [CLOB intro](https://docs.polymarket.com/developers/CLOB/introduction),
[authentication](https://docs.polymarket.com/developers/CLOB/authentication),
[get-prices-history](https://docs.polymarket.com/api-reference/markets/get-prices-history),
[clob-client endpoints.ts](https://github.com/Polymarket/clob-client/blob/main/src/endpoints.ts),
[agent-skills market-data.md](https://github.com/Polymarket/agent-skills/blob/main/market-data.md).

---

## 4. Authentication model (only relevant if you ever trade)

Reading prices needs **nothing**. Authentication exists purely for trading and
user-scoped reads.

- **L1 — private key / EIP-712 signature.** Proves wallet ownership.
  Used only to create/derive API credentials and to locally sign orders.
  Headers: `POLY_ADDRESS`, `POLY_SIGNATURE`, `POLY_TIMESTAMP`, `POLY_NONCE`.
- **L2 — API key + secret + passphrase (HMAC-SHA256).** Generated from L1.
  Required for order placement/cancellation and your own orders/trades
  (`/data/orders`, `/data/trades`). Headers: `POLY_ADDRESS`, `POLY_SIGNATURE`
  (HMAC), `POLY_TIMESTAMP`, `POLY_API_KEY`, `POLY_PASSPHRASE`.
- **Credentials:** create = `POST /auth/api-key`; derive (idempotent) =
  **`GET`** `/auth/derive-api-key`. (Older Python client uses legacy
  `/create-api-key` / `/derive-api-key`.)

| Auth level | Endpoints |
|---|---|
| **None (L0)** | all price/book/midpoint/spread/history/markets reads |
| **L1** | create/derive API key, local order signing |
| **L2** | place/cancel orders, your own orders & trades, balances |

> ⚠️ Bare `/trades` is **not** public — your trade history is `GET /data/trades`
> (L2). The anonymous "what was the last price" read is `/last-trade-price`.

Source: [CLOB authentication](https://docs.polymarket.com/developers/CLOB/authentication).

---

## 5. Sports / World Cup markets — the part we actually need

### Tag IDs (verified live 2026-06-21)

| Tag | id | slug |
|---|---|---|
| Sports | `1` | `sports` |
| Soccer | `100350` | `soccer` |
| World Cup | `519` | `world-cup` |

Soccer markets carry both tag `1` and tag `100350`. Useful league `series` IDs
from `/sports`: EPL `10188`, MLS `10189`, La Liga `10193`, Bundesliga `10194`,
Ligue 1 `10195`, Serie A `10203`.

### Verified World Cup event slugs

- `world-cup-winner` — main "Which country wins the 2026 World Cup?" event
  (`https://polymarket.com/event/world-cup-winner`). Launched 2025-07-02,
  resolves ~2026-07-19/20 on official FIFA results.
- `world-cup-group-a-winner` … `world-cup-group-f-winner` — group winners.
- Landing pages: `polymarket.com/fifa-world-cup`,
  `polymarket.com/sports/soccer`.

### How a "winner" market is shaped (critical)

It is **one Event containing many independent binary Yes/No Markets — one per
team** (~32 at fetch time). Each team market has its **own** `conditionId`,
`clobTokenIds`, `outcomes`, `outcomePrices`. Example (Spain):

```json
{
  "question": "Will Spain win the 2026 FIFA World Cup?",
  "groupItemTitle": "Spain",
  "outcomes": "[\"Yes\", \"No\"]",
  "outcomePrices": "[\"0.1365\", \"0.8635\"]",
  "clobTokenIds": "[\"4394372887385518214471608448209527405727552777602031099972143344338178308080\", \"112680630004798425069810935278212000865453267506345451433803052322987302357330\"]",
  "conditionId": "0x7976b8dbacf9077eb1453a62bcefd6ab2df199acd28aad276ff0d920d6992892"
}
```

To build a win-probability table: loop the event's `markets[]`, take each
market's `groupItemTitle` (team) and the **Yes** price (`outcomePrices[0]`).
Because each team is a separate order book, the Yes prices **don't sum to 1.0**
— normalize by dividing each by the sum of all Yes prices. When a team is
eliminated, its market resolves "No" and Yes → 0.

### Filtering recipes

```bash
# All World Cup events (winner + group winners)
curl "https://gamma-api.polymarket.com/events?tag_id=519&closed=false&active=true&limit=20"
# All soccer events (incl. related tags)
curl "https://gamma-api.polymarket.com/events?tag_id=100350&related_tags=true&active=true&closed=false"
# The winner event, fully expanded
curl "https://gamma-api.polymarket.com/events?slug=world-cup-winner"
```

### Price → odds conversions

Shares are priced 0–1 USDC and pay $1 if correct, so **price = implied
probability**:

- Probability % = `price * 100` (0.1365 → 13.65%)
- Decimal odds = `1 / price` (→ 7.33)
- American odds: `price>0.5` → `-(price/(1-price))*100`; `price<0.5` →
  `((1-price)/price)*100` (0.1365 → +632)
- Normalized field prob = `team_yes / Σ(all team_yes)`

Sources: live Gamma fetches; [market-data overview](https://docs.polymarket.com/market-data/overview).

### 5b. Per-match win/draw/win (1X2) markets — used by `scripts/polymarket-odds.js`

For **single-match odds** (e.g. "Ecuador 62% / Draw 24% / Curaçao 14%") the shape
is different from the tournament-winner market above. Verified live 2026-06-21:

- A match is **one neg-risk Event** with slug **`fifwc-<home>-<away>-<YYYY-MM-DD>`**,
  tagged `sports` (1), `games` (100639), `soccer` (100350), **`fifa-world-cup`
  (102232)**, with `negRisk: true`.
- It contains exactly **three binary Yes/No markets**, identified by
  `groupItemTitle`:
  - `"<Home>"` → "Will \<Home\> win on \<date\>?"
  - `"<Away>"` → "Will \<Away\> win on \<date\>?"
  - `"Draw (<Home> vs. <Away>)"` → "Will … end in a draw?"
- Each market's **Yes price** (`outcomePrices[0]`) is that outcome's implied
  probability. With neg-risk the three sum to ~1.0, so normalize to clean
  percentages. Example — *Tunisia vs. Japan* (`fifwc-tun-jpn-2026-06-21`):
  Japan 67.5% / Draw 20.5% / Tunisia 11.5% (raw Yes summed to 0.995).

**List all match events:** `GET /events?tag_id=102232&closed=false&limit=100`
(paginate via `offset`), then keep events with exactly 3 markets and a `" vs"`
title.

**⚠️ Matching gotcha:** the slug's 3-letter codes are **not reliable** — the
"Ecuador vs. Curaçao" event has slug `fifwc-ecu-kor-...` (`kor` ≠ Curaçao). Match
Polymarket events to your own fixtures by **team name + date**, not by slug
codes. Across all 48 FWC26 teams, only three Polymarket names need an alias:
`IR Iran`→Iran, `DR Congo`→Congo DR, `Bosnia-Herzegovina`→Bosnia and Herzegovina.

**⚠️ Stale markets:** a few match markets read as already resolved (e.g. one
outcome at ~0.999); reflect the source faithfully or filter outcomes ≥ ~0.99 if
you want to hide settled games.

Source: live Gamma fetches (`/events?slug=fifwc-tun-jpn-2026-06-21`,
`/public-search?q=...`).

---

## 6. WebSocket (live updates) — optional, for real-time

Base: `wss://ws-subscriptions-clob.polymarket.com/ws/`

- **Market channel** (`/ws/market`) — **public, no auth.** Subscribe with
  `assets_ids` (the ERC-1155 token IDs):
  ```json
  {"assets_ids":["<tokenId1>","<tokenId2>"],"type":"market","custom_feature_enabled":true}
  ```
  Streams: `book` (full snapshot on subscribe + after trades), `price_change`,
  `last_trade_price`, `tick_size_change`.
- **User channel** (`/ws/user`) — **auth required** (L2 creds in the subscribe
  `auth` object); subscribes by `markets` (condition IDs); streams your
  `trade`/`order` events. Not needed for a tracker.

Heartbeat (community-reported): server pings ~every 5s, expects a pong within
~10s or it drops/freezes the connection — handle keepalive.

Sources: [market-channel docs](https://docs.polymarket.com/market-data/websocket/market-channel),
[agent-skills websocket.md](https://github.com/Polymarket/agent-skills/blob/main/websocket.md).

---

## 7. Rate limits

Enforced via **Cloudflare** on sliding windows; overflow is **throttled/queued**
(some sources report HTTP 429) — use exponential backoff with jitter.

- **Gamma** (general 4,000/10s): `/events` 500/10s, `/markets` 300/10s,
  markets+events combined 900/10s, `/tags` 200/10s, `/public-search` 350/10s.
- **CLOB** (general 9,000/10s): `/price`,`/book`,`/midpoint` 1,500/10s each;
  batch `/prices`,`/books`,`/midpoints` 500/10s each; `/prices-history`
  1,000/10s.
- **Data API** (general 1,000/10s): `/trades` 200/10s, `/positions` 150/10s.

For a tracker these ceilings are enormous — a 30–60s poll over a few dozen
tokens is nowhere near them.

Source: [rate-limits](https://docs.polymarket.com/api-reference/rate-limits).

---

## 8. SDKs & client libraries (and why we probably skip them)

> ⚠️ **The classic SDKs are archived (May 2026).** `Polymarket/clob-client`
> (TS) and `Polymarket/py-clob-client` (Python) are archived in favor of
> `clob-client-v2` (TS, uses `viem`), `py-clob-client-v2`, and a beta unified
> `@polymarket/client` (`Polymarket/ts-sdk`, needs Node ≥24 + pnpm). All wrap
> the same stable REST APIs.

- **TS, read-only without a wallet** *is* supported — instantiate with just the
  host/chain and call public methods:
  ```ts
  import { ClobClient } from "@polymarket/clob-client-v2";
  const client = new ClobClient({ host: "https://clob.polymarket.com", chain: 137 });
  const price = await client.getPrice(tokenId, "BUY");
  const mid   = await client.getMidpoint(tokenId);
  const book  = await client.getOrderBook(tokenId);
  ```
- **Python:** `pip install py-clob-client`; `ClobClient("https://clob.polymarket.com")`
  then `get_price` / `get_midpoint` / `get_order_book`.
- **No standalone Gamma SDK** — it's just public REST. `Polymarket/agents` is an
  LLM trading-agent framework, not a data SDK (and archived). Not relevant here.

**Recommendation: use plain `fetch`/`axios`.** For read-only odds the SDK adds a
heavy `viem`/`ethers` dependency, is mid-migration/beta, and buys us nothing the
REST endpoints don't already give us.

Sources: [clob-client](https://github.com/Polymarket/clob-client),
[py-clob-client](https://github.com/Polymarket/py-clob-client),
[clob-client-v2](https://github.com/Polymarket/clob-client-v2),
[ts-sdk](https://github.com/Polymarket/ts-sdk),
[public methods docs](https://docs.polymarket.com/developers/CLOB/clients/methods-public).

---

## 9. Subgraphs & Data API (not needed for odds)

- **Data API** (`https://data-api.polymarket.com`): `/positions`, `/trades`,
  `/activity`, `/holders`, `/value` — user/market analytics. Public but
  user-scoped; irrelevant to a pure odds tracker.
- **Subgraphs (Goldsky / The Graph): deprecated as of 2026-04-28** after
  Polymarket's v2 contract migration — public endpoints "return incomplete or
  incorrect data." Use the REST APIs instead.

Sources: [Data API endpoints (gist)](https://gist.github.com/shaunlebron/0dd3338f7dea06b8e9f8724981bb13bf),
[polymarket-subgraph](https://github.com/Polymarket/polymarket-subgraph),
[Goldsky deprecation](https://docs.goldsky.com/chains/polymarket).

---

## 10. Legal / geo / attribution

- **Trading is geoblocked for US persons** (ToS prohibits US Persons +
  "Prohibited Localities"; VPN circumvention banned). Geoblock targets **order
  placement** via `polymarket.com/api/geoblock`, **not data**.
- **Reading public market data is explicitly permitted**, even in restricted
  regions — Help Center: users in restricted jurisdictions "can view markets and
  data but cannot trade." The read-only REST APIs are unauthenticated and not
  IP-geoblocked.
- **US regulatory context:** Polymarket re-entered the US in late 2025 via
  **QCX/QCEX**, a CFTC-licensed DCM ("Polymarket US"). The international on-chain
  platform this doc describes remains trading-off-limits to US persons; US
  trading goes through the regulated DCM. Some states (NV, OH, MI, AZ, MD, MA)
  contest prediction-market sports contracts. *(Not legal advice.)*
- **Attribution:** no published open-data license. Recommended: label "Data from
  Polymarket" with a link to the source event page, cache responses, stay within
  rate limits, and review the full [ToS](https://polymarket.com/tos) for
  IP/automated-access clauses before any commercial launch.

Sources: [geoblock](https://docs.polymarket.com/api-reference/geoblock),
[geographic restrictions](https://help.polymarket.com/en/articles/13364163-geographic-restrictions),
[CFTC approval](https://www.cftc.gov/media/12806/Polymarket%20US%20Amended%20Order%20of%20Designation/download).

---

## 11. Recommended integration for FWC26 Tracker

**Read-only, plain HTTP, no SDK, no auth.** Pattern:

1. **Discover** the World Cup events once (cache slugs/IDs):
   `GET /events?tag_id=519&closed=false` → find `world-cup-winner` + group events.
2. **Resolve** each event's `markets[]` → per team: `groupItemTitle`,
   `JSON.parse(clobTokenIds)[0]` (Yes token), `conditionId`.
3. **Poll prices** every 30–60s from CLOB (`/midpoint` or `/price?side=BUY`),
   or batch via `POST /midpoints`. Optionally upgrade to the public WebSocket
   market channel for live ticks.
4. **Normalize** Yes prices into a win-probability table; expose via our own
   REST endpoint (e.g. `GET /odds/world-cup-winner`). Cache + backoff on 429.

Minimal Express sketch:

```js
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB  = "https://clob.polymarket.com";
const UA    = { "User-Agent": "fwc26-tracker/1.0" };

async function getJson(url, opts = {}) {
  const r = await fetch(url, { headers: UA, ...opts });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Build the winner probability table
async function worldCupWinnerOdds() {
  const [event] = await getJson(`${GAMMA}/events?slug=world-cup-winner`);
  const teams = event.markets
    .filter(m => !m.closed)
    .map(m => ({
      team: m.groupItemTitle,
      yesToken: JSON.parse(m.clobTokenIds)[0],
      yesPrice: parseFloat(JSON.parse(m.outcomePrices)[0]),
    }));
  const sum = teams.reduce((s, t) => s + t.yesPrice, 0);
  return teams
    .map(t => ({ ...t, probability: t.yesPrice / sum }))
    .sort((a, b) => b.probability - a.probability);
}
```

For fresher prices, replace `yesPrice` (from Gamma's cached `outcomePrices`)
with a live CLOB `/midpoint?token_id=<yesToken>` call (batched via `/midpoints`).

---

### Quick reference

| Need | Call |
|---|---|
| World Cup events | `GET /events?tag_id=519&closed=false` |
| Soccer feed | `GET /events?tag_id=100350&related_tags=true&active=true&closed=false` |
| Winner event + team markets | `GET /events?slug=world-cup-winner` |
| Live price (Yes token) | `GET https://clob.polymarket.com/price?token_id=<id>&side=BUY` |
| Midpoint | `GET https://clob.polymarket.com/midpoint?token_id=<id>` |
| Price history | `GET https://clob.polymarket.com/prices-history?market=<id>&interval=1d` |
| Live stream | `wss://ws-subscriptions-clob.polymarket.com/ws/market` |

**Remember:** parse the stringified `outcomes`/`outcomePrices`/`clobTokenIds`;
index 0 = Yes; `market=` in price-history is the **token id**, not condition id;
send a `User-Agent`; back off on 429.
