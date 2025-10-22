import type { PrismaConfig } from "prisma";

import dotenv from 'dotenv'

dotenv.config({ path: '../../.env' })

export default {
  schema: "prisma/schema.prisma",
} satisfies PrismaConfig;
