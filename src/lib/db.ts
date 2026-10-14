import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export async function audit(entity: string, entityId: string, action: string, detail?: string) {
  await prisma.auditLog.create({ data: { entity, entityId, action, detail } });
}
