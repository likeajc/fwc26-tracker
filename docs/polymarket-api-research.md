# Polymarket API: research and integration notes

Written 2026-06-21 for the FWC26 Tracker. The question was how to pull
Polymarket prediction-market odds (World Cup winner, group winners, match
results) into the Node.js/Express backend as a read-only source.

The short answer: everything we need is public REST with no auth. Use the Gamma
API to find markets/events and their token IDs, and the CLOB API for live
prices. No wallet, no API key, no signing to read. Reading data isn't
geoblocked, only trading is. And skip the SDK, plain `fetch` or `axios` against
the REST endpoints does the job.

---

## 1. The three public API surfaces

Polymarket runs three separate services, all sitting on top of its smart
contracts on Polygon (chainId 137). A read-only odds tracker only needs the
first two.

| Service | Base URL | Purpose | Auth |
|---|---|---|---|
| Gamma API | `https://gamma-api.polymarket.com` | Find markets and events, plus metadata (titles, dates, volume, liquidity, tags, CLOB token IDs) | None |
| CLOB API | `https://clob.polymarket.com` | Order book, live prices, price history, midpoints, spreads | None for reads, L1/L2 only for trading |
| Data API | `https://data-api.polymarket.com` | User analytics: positions, trades, activity, holders, value | None, but mostly user-scoped |

There's also a WebSocket service (`wss://ws-subscriptions-clob.polymarket.com/ws/`)
and the now-deprecated subgraphs. Those are in sections 6 and 9.

Sources: [Gamma overview](https://docs.polymarket.com/developers/gamma-markets-api/overview),
[CLOB intro](https://docs.polymarket.com/developers/CLOB/introduction),
[API intro](https://docs.polymarket.com/api-reference/introduction).

---

## 2. Gamma API: discovery and metadata (read-only, no auth)

Base: `https://gamma-api.polymarket.com`. Every endpoint is a public GET.

### Key endpoints

| Endpoint | Returns |
|---|---|
| `GET /markets` | List of market objects (filter and paginate) |
| `GET /markets/{id}` | Single market by numeric ID |
| `GET /markets/slug/{slug}` | Single market by slug |
| `GET /events` | List of events (each wraps a `markets[]` array) |
| `GET /events/{id}` | Single event by numeric ID |
| `GET /events/slug/{slug}` | Single event by slug |
| `GET /tags`, `GET /tags/slug/{slug}` | Categories (Sports, Soccer, World Cup, and so on) |
| `GET /sports` | Per-sport metadata (tag IDs, series IDs, resolution sources) |
| `GET /public-search` | Search across events, markets, profiles |
| `GET /series` | Recurring or grouped events, like leagues |

### Common query params

Pagination and sort work on every list endpoint: `limit`, `offset`, `order`
(comma-separated fields), `ascending` (bool, default `false`, which means
descending).

The `/markets` filters: `active`, `closed` (default `false`), `archived`; array
filters `id`, `slug`, `clob_token_ids`, `condition_ids`, `question_ids`; ranges
`liquidity_num_min/max`, `volume_num_min/max`, `start_date_min/max`,
`end_date_min/max`; tags `tag_id`, `related_tags`, `include_tag`; and
`enableOrderBook` to keep only CLOB-tradable markets.

The `/events` filters are the same idea, except the range params drop the `_num`
(`liquidity_min/max`, `volume_min/max`), plus `featured`, `tag_slug`,
`exclude_tag_id`. `order` takes `volume24hr`, `volume`, `liquidity`,
`start_date`, `end_date`, `competitive`, `closed_time`.

Watch the param-name mismatch: markets use `volume_num_min`/`liquidity_num_min`,
events use `volume_min`/`liquidity_min`.

### Market object, the fields that matter

`id`, `question`, `conditionId`, `questionID`, `slug`, `groupItemTitle`
(the team name in a multi-team event, for instance), `outcomes`,
`outcomePrices`, `clobTokenIds`, `lastTradePrice`, `bestBid`, `bestAsk`,
`spread`, `volume`, `volumeNum`, `liquidity`, `volume24hr`, `active`, `closed`,
`archived`, `startDate`, `endDate`, `enableOrderBook`, `orderPriceMinTickSize`,
`orderMinSize`.

### Event object, the fields that matter

`id`, `ticker`, `slug`, `title`, `description`, `active`, `closed`,
`startDate`, `endDate`, `liquidity`, `volume`, `volume24hr`, `negRisk`,
`enableOrderBook`, `markets` (the array of full market objects), `series`,
`tags`.

### The number one gotcha: stringified arrays

`outcomes`, `outcomePrices`, and `clobTokenIds` come back as JSON-encoded
strings, not real arrays. Parse them before you use them:

```js
const outcomes  = JSON.parse(market.outcomes);     // ["Yes","No"]
const prices    = JSON.parse(market.outcomePrices); // ["0.1365","0.8635"]
const tokenIds  = JSON.parse(market.clobTokenIds);  // ["4394...","1126..."]
```

The three arrays line up by index: index `0` is Yes (token and price), index
`1` is No. Send a real `User-Agent` header too, or you'll get blocked now and
then.

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

## 3. CLOB API: live prices (read-only, no auth)

Base: `https://clob.polymarket.com`. These "L0" market-data endpoints need no
authentication.

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

A couple of traps here. `side` describes the order-book side, not what you want
to do: `side=BUY` returns the best ask, `side=SELL` returns the best bid. In the
`/book` arrays the best price sits at the tail (`arr[length-1]`), not index 0.
And the field types aren't consistent, `/price` returns a number while
`/midpoint` and `/spread` return strings, so parse defensively.

### `/prices-history` (historical series)

`market` is required, and it's the clobTokenId (the ERC-1155 token id), not the
conditionId. `interval` is one of `max`, `all`, `1m`, `1w`, `1d`, `6h`, `1h`, or
you skip it and pass a custom `startTs` and `endTs` (unix seconds). `fidelity`
is the resolution in minutes, default 1.

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

## 4. Authentication model (only matters if you trade)

Reading prices needs nothing. Auth is there for trading and for user-scoped
reads.

L1 is a private key with an EIP-712 signature. It proves you own the wallet, and
it's used only to create or derive API credentials and to sign orders locally.
Headers: `POLY_ADDRESS`, `POLY_SIGNATURE`, `POLY_TIMESTAMP`, `POLY_NONCE`.

L2 is an API key plus secret plus passphrase (HMAC-SHA256), generated from L1.
You need it to place or cancel orders and to read your own orders and trades
(`/data/orders`, `/data/trades`). Headers: `POLY_ADDRESS`, `POLY_SIGNATURE`
(the HMAC), `POLY_TIMESTAMP`, `POLY_API_KEY`, `POLY_PASSPHRASE`.

Credentials: create with `POST /auth/api-key`, derive (idempotent) with a `GET`
on `/auth/derive-api-key`. The older Python client uses the legacy paths
`/create-api-key` and `/derive-api-key`.

| Auth level | Endpoints |
|---|---|
| None (L0) | all price/book/midpoint/spread/history/markets reads |
| L1 | create/derive API key, local order signing |
| L2 | place/cancel orders, your own orders and trades, balances |

One thing that trips people up: bare `/trades` isn't public. Your trade history
is `GET /data/trades` (L2). The anonymous "what was the last price" read is
`/last-trade-price`.

Source: [CLOB authentication](https://docs.polymarket.com/developers/CLOB/authentication).

---

## 5. Sports and World Cup markets, the part we actually need

### Tag IDs (checked live 2026-06-21)

| Tag | id | slug |
|---|---|---|
| Sports | `1` | `sports` |
| Soccer | `100350` | `soccer` |
| World Cup | `519` | `world-cup` |

Soccer markets carry both tag `1` and tag `100350`. League `series` IDs from
`/sports`: EPL `10188`, MLS `10189`, La Liga `10193`, Bundesliga `10194`, Ligue 1
`10195`, Serie A `10203`.

### World Cup event slugs (checked live)

`world-cup-winner` is the main "Which country wins the 2026 World Cup?" event
(`https://polymarket.com/event/world-cup-winner`). It launched 2025-07-02 and
resolves around 2026-07-19 or 20 on official FIFA results. `world-cup-group-a-winner`
through `world-cup-group-f-winner` cover the group winners. Landing pages:
`polymarket.com/fifa-world-cup` and `polymarket.com/sports/soccer`.

### How a "winner" market is shaped (important)

It's one event holding a pile of independent Yes/No markets, one per team, about
32 of them when I fetched it. Each team market has its own `conditionId`,
`clobTokenIds`, `outcomes`, `outcomePrices`. Here's Spain:

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

To build a win-probability table, loop the event's `markets[]`, take each
market's `groupItemTitle` (the team) and its Yes price (`outcomePrices[0]`).
Each team is a separate order book, so the Yes prices won't sum to 1.0.
Normalize by dividing each one by the sum of all Yes prices. When a team gets
knocked out, its market resolves No and Yes goes to 0.

### Filtering recipes

```bash
# All World Cup events (winner + group winners)
curl "https://gamma-api.polymarket.com/events?tag_id=519&closed=false&active=true&limit=20"
# All soccer events (incl. related tags)
curl "https://gamma-api.polymarket.com/events?tag_id=100350&related_tags=true&active=true&closed=false"
# The winner event, fully expanded
curl "https://gamma-api.polymarket.com/events?slug=world-cup-winner"
```

### Turning a price into odds

Shares trade between 0 and 1 USDC and pay $1 if they're right, so the price is
the implied probability:

- Probability % is `price * 100` (0.1365 is 13.65%)
- Decimal odds are `1 / price` (about 7.33)
- American odds: if `price > 0.5`, `-(price/(1-price))*100`; if `price < 0.5`,
  `((1-price)/price)*100` (0.1365 gives +632)
- Normalized field probability is `team_yes / sum(all team_yes)`

Sources: live Gamma fetches; [market-data overview](https://docs.polymarket.com/market-data/overview).

### 5b. Per-match win/draw/win (1X2) markets, what `scripts/polymarket-odds.js` uses

For single-match odds (say "Ecuador 62% / Draw 24% / Curaçao 14%") the shape is
different from the winner market above. Checked live 2026-06-21:

A match is one neg-risk event with slug `fifwc-<home>-<away>-<YYYY-MM-DD>`,
tagged `sports` (1), `games` (100639), `soccer` (100350), and `fifa-world-cup`
(102232), with `negRisk: true`.

Inside it there are exactly three Yes/No markets, told apart by `groupItemTitle`:

- `"<Home>"` is "Will \<Home\> win on \<date\>?"
- `"<Away>"` is "Will \<Away\> win on \<date\>?"
- `"Draw (<Home> vs. <Away>)"` is "Will it end in a draw?"

Each market's Yes price (`outcomePrices[0]`) is that outcome's probability. With
neg-risk the three add up to about 1.0, so normalize and, for display, round to
whole-number percentages that hit exactly 100 with the largest-remainder method.
Tunisia vs Japan (`fifwc-tun-jpn-2026-06-21`) was raw Yes 0.675 / 0.205 / 0.115
(sum 0.995), which becomes Japan 69%, Draw 20%, Tunisia 11%.

To list all match events: `GET /events?tag_id=102232&closed=false&limit=100`
(paginate with `offset`), then keep the events with exactly 3 markets and a
`" vs"` in the title.

The matching gotcha, and it's a real one: the slug's 3-letter codes are not
reliable. The "Ecuador vs. Curaçao" event has slug `fifwc-ecu-kor-...`, and
`kor` is not Curaçao. Match Polymarket events to your own fixtures by team name
plus date, never by the slug codes. Out of all 48 FWC26 teams only three need an
alias: `IR Iran` is Iran, `DR Congo` is Congo DR, `Bosnia-Herzegovina` is Bosnia
and Herzegovina.

Stale markets, the other gotcha: a few match markets read as already settled
(one outcome sitting around 0.999). Show the source as-is, or filter outcomes
above roughly 0.99 if you'd rather hide finished games.

Source: live Gamma fetches (`/events?slug=fifwc-tun-jpn-2026-06-21`,
`/public-search?q=...`).

---

## 6. WebSocket (live updates), optional, for real-time

Base: `wss://ws-subscriptions-clob.polymarket.com/ws/`

The market channel (`/ws/market`) is public, no auth. Subscribe with
`assets_ids`, the ERC-1155 token IDs:

```json
{"assets_ids":["<tokenId1>","<tokenId2>"],"type":"market","custom_feature_enabled":true}
```

It streams `book` (a full snapshot on subscribe and after trades),
`price_change`, `last_trade_price`, and `tick_size_change`.

The user channel (`/ws/user`) needs auth (L2 creds in the subscribe `auth`
object), subscribes by `markets` (condition IDs), and streams your `trade` and
`order` events. A tracker doesn't need it.

Heartbeat, community-reported: the server pings about every 5 seconds and wants
a pong inside about 10, or it drops or freezes the connection. Handle the
keepalive.

Sources: [market-channel docs](https://docs.polymarket.com/market-data/websocket/market-channel),
[agent-skills websocket.md](https://github.com/Polymarket/agent-skills/blob/main/websocket.md).

---

## 7. Rate limits

Cloudflare enforces these on sliding windows. Going over gets you throttled or
queued (some sources report HTTP 429), so back off with jitter.

- Gamma (general 4,000/10s): `/events` 500/10s, `/markets` 300/10s,
  markets+events combined 900/10s, `/tags` 200/10s, `/public-search` 350/10s.
- CLOB (general 9,000/10s): `/price`, `/book`, `/midpoint` 1,500/10s each;
  batch `/prices`, `/books`, `/midpoints` 500/10s each; `/prices-history`
  1,000/10s.
- Data API (general 1,000/10s): `/trades` 200/10s, `/positions` 150/10s.

For a tracker these ceilings are huge. A 30 to 60 second poll over a few dozen
tokens isn't close to them.

Source: [rate-limits](https://docs.polymarket.com/api-reference/rate-limits).

---

## 8. SDKs and client libraries (and why we skip them)

Heads up: the classic SDKs got archived in May 2026. `Polymarket/clob-client`
(TS) and `Polymarket/py-clob-client` (Python) are archived in favor of
`clob-client-v2` (TS, on `viem`), `py-clob-client-v2`, and a beta unified
`@polymarket/client` (`Polymarket/ts-sdk`, which wants Node 24 and pnpm). They
all wrap the same stable REST APIs.

You can read with the TS client and no wallet. Instantiate with just the host
and chain and call the public methods:

```ts
import { ClobClient } from "@polymarket/clob-client-v2";
const client = new ClobClient({ host: "https://clob.polymarket.com", chain: 137 });
const price = await client.getPrice(tokenId, "BUY");
const mid   = await client.getMidpoint(tokenId);
const book  = await client.getOrderBook(tokenId);
```

In Python it's `pip install py-clob-client`, then
`ClobClient("https://clob.polymarket.com")` and `get_price` / `get_midpoint` /
`get_order_book`. There's no standalone Gamma SDK, it's just public REST.
`Polymarket/agents` is an LLM trading-agent framework, not a data SDK, and it's
archived too, so it's not relevant here.

So the call is to use plain `fetch` or `axios`. For read-only odds the SDK drags
in a heavy `viem`/`ethers` dependency, it's mid-migration and beta, and it gives
us nothing the REST endpoints don't already.

Sources: [clob-client](https://github.com/Polymarket/clob-client),
[py-clob-client](https://github.com/Polymarket/py-clob-client),
[clob-client-v2](https://github.com/Polymarket/clob-client-v2),
[ts-sdk](https://github.com/Polymarket/ts-sdk),
[public methods docs](https://docs.polymarket.com/developers/CLOB/clients/methods-public).

---

## 9. Subgraphs and Data API (not needed for odds)

The Data API (`https://data-api.polymarket.com`) has `/positions`, `/trades`,
`/activity`, `/holders`, `/value`. It's public but user-scoped, so it doesn't
matter to a pure odds tracker.

The subgraphs (Goldsky and The Graph) were deprecated on 2026-04-28 after
Polymarket's v2 contract migration. The public endpoints now "return incomplete
or incorrect data," so use the REST APIs instead.

Sources: [Data API endpoints (gist)](https://gist.github.com/shaunlebron/0dd3338f7dea06b8e9f8724981bb13bf),
[polymarket-subgraph](https://github.com/Polymarket/polymarket-subgraph),
[Goldsky deprecation](https://docs.goldsky.com/chains/polymarket).

---

## 10. Legal, geo, attribution

Trading is geoblocked for US persons. The ToS bars US Persons and "Prohibited
Localities," and VPN circumvention is banned. The geoblock hits order placement
through `polymarket.com/api/geoblock`, not the data.

Reading public market data is allowed, even in restricted regions. The Help
Center says users in restricted jurisdictions "can view markets and data but
cannot trade." The read-only REST APIs are unauthenticated and aren't
IP-geoblocked.

On the US side: Polymarket came back to the US in late 2025 through QCX/QCEX, a
CFTC-licensed DCM ("Polymarket US"). The international on-chain platform this doc
describes is still off-limits to US persons for trading; US trading goes through
the regulated DCM. A handful of states (NV, OH, MI, AZ, MD, MA) are fighting
prediction-market sports contracts. None of this is legal advice.

Attribution: there's no published open-data license. Label it "Data from
Polymarket" with a link to the source event page, cache responses, stay inside
the rate limits, and read the full [ToS](https://polymarket.com/tos) for the IP
and automated-access clauses before any commercial launch.

Sources: [geoblock](https://docs.polymarket.com/api-reference/geoblock),
[geographic restrictions](https://help.polymarket.com/en/articles/13364163-geographic-restrictions),
[CFTC approval](https://www.cftc.gov/media/12806/Polymarket%20US%20Amended%20Order%20of%20Designation/download).

---

## 11. How we integrate it in FWC26 Tracker

Read-only, plain HTTP, no SDK, no auth. The flow:

1. Discover the World Cup events once and cache the slugs and IDs:
   `GET /events?tag_id=519&closed=false` to find `world-cup-winner` and the group
   events.
2. Resolve each event's `markets[]` into per-team data: `groupItemTitle`,
   `JSON.parse(clobTokenIds)[0]` (the Yes token), `conditionId`.
3. Poll prices every 30 to 60 seconds from CLOB (`/midpoint` or
   `/price?side=BUY`), or batch them with `POST /midpoints`. Move up to the
   public WebSocket market channel later if you want live ticks.
4. Normalize the Yes prices into a win-probability table and serve it from our
   own endpoint (for example `GET /odds/world-cup-winner`). Cache it, and back
   off on 429.

A small Express sketch:

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

For fresher numbers, swap `yesPrice` (Gamma's cached `outcomePrices`) for a live
CLOB `/midpoint?token_id=<yesToken>` call, batched through `/midpoints`.

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

The things to remember: parse the stringified `outcomes`, `outcomePrices`, and
`clobTokenIds`; index 0 is Yes; `market=` in price-history is the token id, not
the condition id; send a `User-Agent`; and back off on 429.
