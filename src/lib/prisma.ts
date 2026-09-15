import { PrismaClient } from "@prisma/client";

// Single shared Prisma client for the process. Modules import this instead
// of instantiating their own client so transactions can span module
// boundaries (e.g. a driver sale that also posts ledger entries).
export const prisma = new PrismaClient();

export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
