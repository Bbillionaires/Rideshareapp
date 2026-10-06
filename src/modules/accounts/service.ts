import { FuelType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";

/**
 * ACCOUNTS module: minimal identity management for test riders/drivers and
 * driver online/offline presence.
 *
 * This codebase has no authentication system (no login, no sessions, no
 * passwords) — see docs/API.md's "Auth" section. Every endpoint across every
 * module trusts whatever driverId/riderId/etc. the caller supplies. This
 * module exists only so a test rider/driver can be created and identified at
 * all (previously the only way to create a Driver/Rider row was a raw Prisma
 * call in a test fixture — see tests/helpers/db.ts); it does not add any
 * authentication, and none should be inferred from its existence.
 */

// ----------------------------------------------------------------------------
// Drivers / Riders
// ----------------------------------------------------------------------------

export interface CreateDriverInput {
  name: string;
  email: string;
}

export async function createDriver(input: CreateDriverInput) {
  if (!input.name?.trim()) badRequest("name is required");
  if (!input.email?.trim()) badRequest("email is required");
  return prisma.driver.create({ data: { name: input.name, email: input.email } });
}

export async function getDriver(id: string) {
  const driver = await prisma.driver.findUnique({ where: { id }, include: { vehicles: true } });
  if (!driver) notFound(`Driver ${id} not found`);
  return driver;
}

export interface CreateRiderInput {
  name: string;
  email: string;
}

export async function createRider(input: CreateRiderInput) {
  if (!input.name?.trim()) badRequest("name is required");
  if (!input.email?.trim()) badRequest("email is required");
  return prisma.rider.create({ data: { name: input.name, email: input.email } });
}

export async function getRider(id: string) {
  const rider = await prisma.rider.findUnique({ where: { id } });
  if (!rider) notFound(`Rider ${id} not found`);
  return rider;
}

// ----------------------------------------------------------------------------
// Vehicles
// ----------------------------------------------------------------------------

export interface CreateVehicleInput {
  driverId: string;
  marketId: string;
  make: string;
  model: string;
  year: number;
  plate: string;
  fuelType: FuelType;
}

/**
 * Vehicles are created pre-approved in this MVP (there is no admin vehicle
 * review queue/UI yet) so a test driver can immediately go online and drive —
 * see EV_INCENTIVES' eligibility.ts for why approvalStatus matters (EV bonus
 * eligibility is derived only from an APPROVED EV vehicle).
 */
export async function createVehicle(input: CreateVehicleInput) {
  if (!input.make?.trim()) badRequest("make is required");
  if (!input.model?.trim()) badRequest("model is required");
  if (!input.plate?.trim()) badRequest("plate is required");
  if (!Number.isInteger(input.year)) badRequest("year must be an integer");

  const driver = await prisma.driver.findUnique({ where: { id: input.driverId } });
  if (!driver) notFound(`Driver ${input.driverId} not found`);
  const market = await prisma.market.findUnique({ where: { id: input.marketId } });
  if (!market) notFound(`Market ${input.marketId} not found`);

  return prisma.vehicle.create({
    data: {
      driverId: input.driverId,
      marketId: input.marketId,
      make: input.make,
      model: input.model,
      year: input.year,
      plate: input.plate,
      fuelType: input.fuelType,
      approvalStatus: "APPROVED",
      verifiedAt: new Date(),
    },
  });
}

export async function listVehiclesForDriver(driverId: string) {
  return prisma.vehicle.findMany({ where: { driverId }, orderBy: { createdAt: "desc" } });
}

// ----------------------------------------------------------------------------
// Driver online/offline presence (DriverOnlineSession)
// ----------------------------------------------------------------------------

export interface GoOnlineInput {
  marketId: string;
  vehicleId?: string | null;
}

export async function goOnline(driverId: string, input: GoOnlineInput) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) notFound(`Driver ${driverId} not found`);

  const existing = await prisma.driverOnlineSession.findFirst({
    where: { driverId, endedAt: null },
  });
  if (existing) badRequest(`Driver ${driverId} is already online (session ${existing.id})`);

  return prisma.driverOnlineSession.create({
    data: {
      driverId,
      marketId: input.marketId,
      vehicleId: input.vehicleId ?? null,
      startedAt: new Date(),
    },
  });
}

export async function goOffline(driverId: string) {
  const session = await prisma.driverOnlineSession.findFirst({
    where: { driverId, endedAt: null },
  });
  if (!session) badRequest(`Driver ${driverId} is not currently online`);

  const endedAt = new Date();
  const durationMinutes = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000);
  return prisma.driverOnlineSession.update({
    where: { id: session.id },
    data: { endedAt, durationMinutes },
  });
}

export async function getDriverStatus(driverId: string) {
  const session = await prisma.driverOnlineSession.findFirst({
    where: { driverId, endedAt: null },
  });
  return { online: Boolean(session), session: session ?? null };
}

// ----------------------------------------------------------------------------
// Reference data (markets / service types) — read-only lookups the frontends
// need for dropdowns; owned by GEOGRAPHY, exposed here for convenience.
// ----------------------------------------------------------------------------

export async function listMarkets() {
  return prisma.market.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}

export async function listServiceTypes() {
  return prisma.serviceType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}
