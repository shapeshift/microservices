# ShapeShift Backend Monorepo

This is a Turborepo monorepo containing the ShapeShift backend microservices.

## Architecture

```
shapeshift-backend/
├── apps/
│   ├── user-service/          # User accounts microservice
│   ├── swap-service/          # Swap microservice
│   └── notifications-service/ # Notifications microservice
├── packages/
│   ├── shared-types/          # Shared TypeScript types
│   └── shared-utils/          # Shared utilities
├── prisma/
│   ├── schema/                # Prisma schema files (one per service)
│   └── migrations/            # Shared migration history
├── turbo.json                 # Turborepo configuration
├── package.json               # Root package.json
└── docker-compose.yml         # Docker Compose for development
```

## Services

### User Service (`apps/user-service`)

- **Port**: 3002
- **Purpose**: Manages user accounts, devices, and authentication
- **Database**: PostgreSQL
- **API**: `/users/*`

### Swap Service (`apps/swap-service`)

- **Port**: 3001
- **Purpose**: Handles swaps and WebSocket connections
- **Database**: PostgreSQL
- **API**: `/swaps/*`
- **WebSocket**: Real-time updates
- **Dependencies**: User Service, Notifications Service

### Notifications Service (`apps/notifications-service`)

- **Port**: 3003
- **Purpose**: Manages notifications and push notifications
- **Database**: PostgreSQL
- **API**: `/notifications/*`
- **WebSocket**: Real-time notifications
- **Dependencies**: User Service

## Service Communication

```
┌─────────────────┐    HTTP    ┌─────────────────┐
│   User Service  │◄──────────►│  Swap Service   │
│   (Port 3002)   │            │  (Port 3001)    │
└─────────────────┘            └─────────────────┘
         ▲                              ▲
         │ HTTP                         │ HTTP
         ▼                              ▼
┌─────────────────┐            ┌─────────────────┐
│ Notifications   │            │ Notifications   │
│ Service         │            │ Service         │
│ (Port 3003)     │            │ (Port 3003)     │
└─────────────────┘            └─────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 22+
- Yarn 4+
- Docker (for containerized development)

### Installation

1. **Copy the environment variables for each service** (see [Environment Variables](#environment-variables))
   Ask the team for the EXPO token used to launch notifications.

2. **Install dependencies**:

   ```bash
   yarn install
   ```

3. **Build**:
   ```bash
   yarn build
   ```

### Development

#### Option 1: Docker Development (recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for a specific service
docker-compose logs -f swap-service db
```

#### Option 2: Local Development

```bash
yarn start:dev
```

### Available Scripts

#### Root Level

- `yarn build` - Build all packages and apps (runs `db:generate` first)
- `yarn dev` - Start all services in development mode
- `yarn test` - Run tests
- `yarn lint` - Lint all packages
- `yarn db:generate` - Generate Prisma client
- `yarn db:migrate` - Deploy pending migrations
- `yarn db:migrate:status` - Check migration state against a database
- `yarn db:migrate:create <name>` - Create a new migration (see below)
- `yarn db:studio` - Open Prisma Studio
- `yarn clean` - Clean all builds and node_modules

## Database Migrations

All migrations are managed from the root using a shared Prisma schema at `prisma/schema/`.

### Creating a new migration

1. Update the relevant schema file in `prisma/schema/`

2. Start a fresh local DB and apply existing migrations as baseline:

   ```bash
   docker-compose down -v && docker-compose up -d db
   DATABASE_URL="postgresql://postgres:password@localhost:5432/microservices" yarn db:migrate
   ```

3. Generate the migration (creates the file without applying it):

   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/microservices" yarn db:migrate:create <migration_name>
   ```

4. Review the generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`

5. Apply and test locally:

   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/microservices" yarn db:migrate
   ```

6. Commit and open a PR — production migrations are applied automatically on deployment.

### Validating migration state against a database

```bash
DATABASE_URL="postgresql://..." yarn db:migrate:status
```

## API Documentation

### User Service Endpoints

```
POST   /users                    # Create user
GET    /users                    # Get all users
GET    /users/:userId            # Get user by ID
POST   /users/get-or-create      # Get or create user
GET    /users/account/:accountId # Get user by account ID
POST   /users/:userId/account-id # Add account ID
POST   /users/:userId/devices    # Register device
GET    /users/:userId/devices    # Get user devices
```

### Swap Service Endpoints

```
POST   /swaps                    # Create swap
GET    /swaps                    # Get all swaps
GET    /swaps/:swapId            # Get swap by ID
GET    /swaps/user/:userId       # Get swaps by user
PUT    /swaps/:swapId            # Update swap
```

### Notifications Service Endpoints

```
POST   /notifications            # Create notification
POST   /notifications/register-device # Register device
GET    /notifications/user/:userId    # Get user notifications
PUT    /notifications/:id/read   # Mark notification as read
GET    /notifications/devices/:userId # Get user devices
POST   /notifications/send-to-user    # Send notification to user
POST   /notifications/send-to-device  # Send notification to device
```

## Environment Variables

Each service has its own `.env` file. Copy from the example and fill in the required values:

```bash
cp apps/swap-service/.env.example apps/swap-service/.env
cp apps/user-service/.env.example apps/user-service/.env
cp apps/notifications-service/.env.example apps/notifications-service/.env
```

Refer to each service's `.env.example` for the full list of required variables.

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests: `yarn test`
4. Run linting: `yarn lint`
5. Submit a pull request

## Troubleshooting

### Common Issues

1. **Port conflicts**: Make sure ports 3001, 3002, and 3003 are available
2. **Database issues**: Run `yarn db:generate` then `DATABASE_URL="..." yarn db:migrate`
3. **Build issues**: Clean and rebuild: `yarn clean && yarn build`
4. **Service communication**: Check environment variables for service URLs

## Local Onramper authorization testing

The Onramper checkout requires a wallet-verified session. The server generates a five-minute SIWE challenge, verifies the signature, and atomically consumes the challenge before issuing a fifteen-minute session. Each intent is bound to that session, and its destination comes from the verified wallet rather than a client-supplied address. Redemption rechecks the session and wallet proof and atomically consumes the intent. Session deletion also deletes outstanding intents.

The local simulator uses generated Ed25519 keys, a dummy provider API key, and a dedicated PostgreSQL database. It accepts ETH on Ethereum with USD, verifies widget signatures, and rejects modified, expired, or reused widget URLs. It never creates a real Onramper order or makes a transfer. Keep production credentials out of this setup.

Use Node 22 and Yarn 4.7. If the `yarn` shim is unavailable on this machine, replace `yarn` with `node /tmp/shapeshift-yarn-4.7.cjs`; that Yarn 4.7 launcher is already available locally. In the `security-fixes/web01-server` worktree:

```sh
yarn install --immutable
yarn onramper:db
```

Keep that terminal open. The database launcher downloads an isolated PostgreSQL runtime from npm into the system temporary directory when needed, binds only to `127.0.0.1:55439`, and creates `onramper_local` and `onramper_authorization_test`. It needs neither Docker nor sudo and does not alter system services. Its local data persists between runs; stop it with Ctrl+C.

In a second terminal in the same worktree:

```sh
yarn onramper:setup
yarn onramper:local
```

Setup generates Prisma types, applies migrations to `onramper_local`, and builds the shared package declarations. The launcher starts the wallet-auth API on port 3002 and the provider simulator on port 3999. It explicitly supplies its validated local database URL to Prisma. Signing keys are generated in memory at startup. Stop it with Ctrl+C; restart invalidates previously signed simulator URLs.

In a third terminal in the paired `security-fixes/web01` worktree:

```sh
pnpm install --frozen-lockfile
pnpm run build:packages
pnpm run onramper:local
```

Open **http://localhost:5173**. Allow the first development load to finish. In **Buy/Sell**, choose **ETH on Ethereum**, **USD**, and a test amount such as **100**, then choose **Onramper** from the provider quotes. Connect a wallet that supports EVM message signing and use its own destination address. Approve the sign-in message when checkout requests it. No on-chain transaction or token allowance is requested. The simulator should show **Wallet-authorized checkout passed**, the verified destination, and your selected amount. If the browser blocks the popup, use the app's Continue button to open it once.

Try rejecting the wallet signature, supplying a different destination, changing wallets while a signature is pending, and reopening a consumed simulator URL. These must not produce another authorized checkout. Repeat the Sell flow with the same supported ETH wallet; the simulator accepts sell amounts without requiring a real transfer. The app may require an appropriate test wallet balance to enable its Sell button.

The local command overrides only Onramper's configuration. The trading app can still fetch ordinary asset/market data and other providers' quotes. The simulator has a fixed illustrative ETH quote, not a market price or purchase offer.

### Automated checks

With the simulator running, a disposable wallet exercises the live local API and widget verifier:

```sh
yarn onramper:smoke
```

For the security suite without a database, run `yarn test:security`. To exercise the same HTTP cases against actual PostgreSQL and two application replicas, prepare the disposable test database, then run:

```sh
DATABASE_URL=postgresql://onramper:local-test-only@127.0.0.1:55439/onramper_authorization_test yarn db:migrate
yarn test:onramper:postgres
```

The PostgreSQL suite deletes Onramper test challenges, sessions, and intents between cases. It refuses any database that is not on loopback and named `onramper_authorization_test`. Provider calls are mocked in that suite. Tests cover anonymous access, forged origins, wrong signatures, chain/destination mismatch, cross-session access, expiry, revocation, tampering, concurrent challenge/intent consumption, and shared quotas. Contract-wallet verifier tests mock RPC responses; live contract-wallet acceptance remains a staging check.

In the web worktree:

```sh
pnpm exec vitest run --project web src/components/Modals/FiatRamps/fiatRampProviders/onramper/index.test.ts src/components/Modals/FiatRamps/fiatRampProviders/onramper/useOnramperWalletAuth.test.ts
pnpm run lint --fix
pnpm run type-check
```

### Production configuration

`ONRAMPER_CHECKOUT_ENABLED` defaults to disabled. Both checkout routes remain protected by `OnramperSessionGuard` when explicitly enabled. The public-access metadata permits these wallet-authenticated routes through the separate service/device guard; it does not bypass their wallet-session guard. Authentication challenge and verification routes are public, validated, and rate-limited.

Supported verification networks are Ethereum, Optimism, BSC, Polygon, Base, Arbitrum, Avalanche C-Chain, and Gnosis. The paired app retains its existing Gnosis provider exclusion. Non-EVM assets are excluded from Onramper until chain-specific ownership verification is implemented. Externally owned wallets verify offline. To support contract wallets, configure `ONRAMPER_EVM_RPC_URLS` as a chain-ID-to-trusted-HTTPS-RPC JSON mapping, for example `{"1":"https://your-reviewed-ethereum-rpc"}`. The server checks the RPC chain ID and rechecks contract signature validity at issuance and redemption. RPC failure or revoked authorization fails closed. Do not accept RPC URLs from clients.

Register separate V2 public keys with Onramper for staging and production; keep private keys exclusively on the backend. Configure exact application and redirect origins, the paired frontend signer URL, and trusted proxy peers. HTTP provider/RPC URLs are accepted only for loopback in a non-production runtime. Test with Onramper's real staging environment before explicitly enabling production checkout. Do not restore V1 or the exposed signing secret during rollback.

Separate staging and production Ed25519 keys were generated locally on 12 October 2026. Their PKCS8 private PEM files are in `apps/user-service/.env.onramper-keys/{staging,production}-private.pem`; matching SPKI public PEM files use the `-public.pem` suffix. The directory is owner-only and excluded from Git, Docker contexts, and Railway uploads. These files are local custody copies and are not automatically loaded by the service or the simulator. The production private key has been provisioned as `ONRAMPER_V2_PRIVATE_KEY` on Railway microservices → production → user-service, with redeployment skipped. Staging provisioning remains pending. The backend reads only this V2 variable and never falls back to a legacy key; do not put it in a frontend variable, tracked file, or build argument. Transfer custody to the team's approved secrets manager before removing or replacing this worktree. Register only the matching public key with Onramper.
