import 'dotenv/config';

import type { PrismaConfig } from 'prisma';

export default {
  schema: 'prisma/schema.prisma',
} satisfies PrismaConfig;
