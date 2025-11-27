FROM node:22-alpine AS base

WORKDIR /workspace

RUN corepack enable

# Install dependencies and build
FROM base AS builder

ARG COINSTACK

COPY package.json yarn.lock .yarnrc.yml turbo.json tsconfig*.json ./
COPY packages ./packages
COPY apps/ ./apps

RUN yarn install --immutable
RUN yarn build

# Production image
FROM base AS runner

ARG COINSTACK

COPY --from=builder /workspace/.yarnrc.yml ./.yarnrc.yml
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/yarn.lock ./yarn.lock
COPY --from=builder /workspace/node_modules ./node_modules

COPY --from=builder /workspace/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /workspace/packages/shared-types/dist ./packages/shared-types/dist

COPY --from=builder /workspace/packages/shared-utils/package.json ./packages/shared-utils/package.json
COPY --from=builder /workspace/packages/shared-utils/dist ./packages/shared-utils/dist

COPY --from=builder /workspace/apps/${COINSTACK}/package.json ./apps/${COINSTACK}/package.json
COPY --from=builder /workspace/apps/${COINSTACK}/node_modules ./apps/${COINSTACK}/node_modules
COPY --from=builder /workspace/apps/${COINSTACK}/dist ./apps/${COINSTACK}/dist
COPY --from=builder /workspace/apps/${COINSTACK}/prisma ./apps/${COINSTACK}/prisma

RUN corepack prepare

WORKDIR /workspace/apps/${COINSTACK}
