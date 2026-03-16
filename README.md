# dartsia-backend

> NestJS API, block ingestion worker, and host scanner for the [Dartsia](https://dartsia.app) blockchain explorer — built for the [Sia](https://sia.tech) decentralized storage network.

---

## Overview

`dartsia-backend` is the server-side component of the Dartsia platform. It maintains a continuously synchronized replica of the Sia blockchain, exposes a versioned REST API consumed by the frontend, and runs parallel pipelines for host scanning and network analytics.

### The Role of `explored`
The backend is designed to work in tandem with the [Sia Foundation's `explored`](https://api.sia.tech/explored) service. Unlike traditional blockchain indexers that require heavy local data processing, Dartsia leverages `explored` as its primary source of truth for:
- **V2 Protocol Support**: Native parsing of Sia V2 transactions and host data.
- **Efficient Ingestion**: Providing pre-processed block and transaction data that is then stored and enriched in the local PostgreSQL database.
- **Network Statistics**: Accessing real-time chain metrics without the overhead of a full Sia node locally.

The architecture adopts a hybrid data sourcing strategy: a BullMQ-powered ingestion worker indexes data from the `explored` API into PostgreSQL, while individual entity lookups fall back to the same API when local data is unavailable.

---

## Architecture

```
dartsia-backend/
├── apps/
│   ├── explorer/     # REST API (NestJS) — blocks, transactions, hosts, stats
│   └── worker/       # Background jobs — block ingestion, host scanning
├── libs/
│   ├── common/       # Shared DTOs and interfaces
│   ├── database/     # TypeORM entities and migrations
│   └── sia-client/   # Typed HTTP client for the Sia explored API
```

---

## Features

- **Block Ingestion** — BullMQ worker follows the chain from the tip backwards, persisting blocks and embedded transactions as typed JSONB in PostgreSQL
- **Transaction API** — recent transaction stream with type classification (transfer, contract formation, revision, storage proof, host announcement) and per-transaction lookup with V1/V2 support
- **Host Scanner** — parallel pipeline that resolves host on-chain announcements with live scan results and applies IP geolocation via `geoip-lite`
- **Network Stats** — aggregated network metrics: block height, sync state, active hosts, average storage price
- **Authentication** — API key-based authentication via `x-api-key` header
- **Caching** — in-memory cache with configurable TTL per endpoint via `@nestjs/cache-manager`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS |
| Language | TypeScript |
| Database | PostgreSQL + TypeORM |
| Queue | BullMQ + Redis |
| HTTP Client | Axios |
| Geolocation | geoip-lite |
| Containerization | Docker |

---

## Getting Started

**Requirements:** Node.js 18+, PostgreSQL, Redis, and access to a **Sia `explored` instance**.

```bash
# Clone the repository
git clone https://github.com/poclus2/dartsia-backend.git
cd dartsia-backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in DATABASE_URL, REDIS_URL, SIA_EXPLORED_API, API_KEY

# Run database migrations
npm run migration:run

# Start the API
npx nx serve explorer

# Start the worker (separate terminal)
npx nx serve worker
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/dartsia` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `SIA_EXPLORED_API` | Sia explored node base URL | `https://api.siascan.com` |
| `API_KEY` | Secret key for API authentication | `your-secret-key` |
| `PORT` | Port for the explorer API | `3000` |

---

## API

All endpoints are prefixed with `/api/v1/explorer` and require an `x-api-key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/blocks` | Paginated list of recent blocks |
| `GET` | `/blocks/tip` | Current chain tip |
| `GET` | `/blocks/:id` | Block by height or hash |
| `GET` | `/blocks/stats` | Network block statistics |
| `GET` | `/tx/recent` | Recent transaction stream |
| `GET` | `/tx/:id` | Transaction by ID |
| `GET` | `/hosts` | Paginated list of scanned hosts |
| `GET` | `/hosts/:publicKey` | Host detail by public key |
| `GET` | `/network/stats` | Current network statistics |

---

## Docker

```bash
# Build
docker build -t dartsia-backend .

# Run with environment
docker run -p 3000:3000 \
  -e DATABASE_URL=... \
  -e REDIS_URL=... \
  -e SIA_EXPLORED_API=... \
  -e API_KEY=... \
  dartsia-backend
```

A `docker-compose.yml` is available at the root of the repository for local development including PostgreSQL and Redis.

---

## Deployment

The backend is deployed automatically via GitHub Actions on every push to `main`. The pipeline builds a Docker image, publishes it to the GitHub Container Registry (`ghcr.io/poclus2/dartsia-backend`), and triggers a rolling update on the production VPS via SSH.

---

## Related

- **[dartsia-frontend](https://github.com/poclus2/dartsia-frontend)** — React/TypeScript interface
- **[troubleshootd](https://github.com/SiaFoundation/troubleshootd)** — Sia Foundation host diagnostic API (planned integration)
- **[Sia Foundation](https://sia.tech)** — the Sia protocol and ecosystem

---

## License

MIT
