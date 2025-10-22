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
├── turbo.json                 # Turborepo configuration
├── package.json               # Root package.json
└── docker-compose.yml         # Docker Compose for development
```

## Services

### User Service (`apps/user-service`)
- **Port**: 3002
- **Purpose**: Manages user accounts, devices, and authentication
- **Database**: SQLite (development) / PostgreSQL (production)
- **API**: `/users/*`

### Swap Service (`apps/swap-service`)
- **Port**: 3001
- **Purpose**: Handles swaps and WebSocket connections
- **Database**: SQLite (development) / PostgreSQL (production)
- **API**: `/swaps/*`
- **WebSocket**: Real-time updates
- **Dependencies**: User Service, Notifications Service

### Notifications Service (`apps/notifications-service`)
- **Port**: 3003
- **Purpose**: Manages notifications and push notifications
- **Database**: SQLite (development) / PostgreSQL (production)
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
- Docker (optional, for containerized development)

### Installation

1. **Copy the environment variables**
  Copy `.env.example` into `.env` at the root of the repository
  Ask the team for the EXPO token used to launch notifications

1. **Install dependencies**:
   ```bash
   yarn install
   ```

2. **Build shared packages**:
   ```bash
   yarn build
   ```

3. **Set up databases**:
   ```bash
   # Generate Prisma clients
   yarn db:generate

   # Push db structure
   yarn db:push
   
   # Run migrations
   yarn db:migrate
   ```

### Development

#### Option 1: Local Development
```bash
# Start all services in development mode
yarn start:dev

# Or start individual services
yarn workspace @shapeshift/user-service start:dev
yarn workspace @shapeshift/swap-service start:dev
yarn workspace @shapeshift/notifications-service start:dev
```

#### Option 2: Docker Development
```bash
# Start all services with Docker
docker-compose up -d

# View logs
docker-compose logs -f
```

### Available Scripts

#### Root Level
- `yarn build` - Build all packages and apps
- `yarn dev` - Start all services in development mode
- `yarn test` - Run tests for all packages
- `yarn lint` - Lint all packages
- `yarn db:generate` - Generate Prisma clients
- `yarn db:push` - Push default database structure
- `yarn db:migrate` - Run database migrations
- `yarn clean` - Clean all builds and node_modules

#### Individual Services
- `yarn workspace @shapeshift/user-service dev` - Start user service
- `yarn workspace @shapeshift/swap-service dev` - Start swap service
- `yarn workspace @shapeshift/notifications-service dev` - Start notifications service
- `yarn workspace @shapeshift/shared-types build` - Build shared types
- `yarn workspace @shapeshift/shared-utils build` - Build shared utils

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

### Swap Service
```env
PORT=3001
DATABASE_URL=file:./dev.db
USER_SERVICE_URL=http:/localhost:3001
NOTIFICATIONS_SERVICE_URL=http:/localhost:3003
```

### User Service
```env
PORT=3002
DATABASE_URL=file:./user-service.db
ACCOUNT_ID_SALT=your-salt-here
```

### Notifications Service
```env
PORT=3003
DATABASE_URL=file:./notifications-service.db
USER_SERVICE_URL=http:/localhost:3001
EXPO_ACCESS_TOKEN=your-expo-token
```

## Database Setup

### Production (PostgreSQL)
Update the `DATABASE_URL` in each service's environment to point to your PostgreSQL instance.

## Service Communication

### HTTP Communication
Services communicate via HTTP APIs using the service clients in `@shapeshift/shared-utils`:

```typescript
import { UserServiceClient, NotificationsServiceClient } from '@shapeshift/shared-utils';

const userClient = new UserServiceClient();
const notificationsClient = new NotificationsServiceClient();

/ Get user from user service
const user = await userClient.getUserById(userId);

/ Send notification
await notificationsClient.createNotification({
  userId,
  title: 'Swap Completed',
  body: 'Your swap has been completed successfully',
  type: 'SWAP_COMPLETED',
  swapId: swapId
});
```

### WebSocket Communication
- **Swap Service**: Handles swap-related WebSocket connections
- **Notifications Service**: Handles notification-related WebSocket connections

## Deployment

### Docker Deployment
```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Deploy
docker-compose -f docker-compose.prod.yml up -d
```

### Individual Service Deployment
Each service can be deployed independently as they are separate NestJS applications.

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests: `yarn test`
4. Run linting: `yarn lint`
5. Submit a pull request

## Troubleshooting

### Common Issues

1. **Port conflicts**: Make sure ports 3001, 3002, and 3003 are available
2. **Database issues**: Run `yarn db:generate` and `yarn db:migrate`
3. **Build issues**: Clean and rebuild: `yarn clean && yarn build`
4. **Service communication**: Check environment variables for service URLs

### Logs
```bash
# View service logs
yarn workspace @shapeshift/user-service logs
yarn workspace @shapeshift/swap-service logs
yarn workspace @shapeshift/notifications-service logs

# Docker logs
docker-compose logs -f user-service
docker-compose logs -f swap-service
docker-compose logs -f notifications-service
```
