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
