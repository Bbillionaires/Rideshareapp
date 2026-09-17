import { TherapistSafeRoute } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";

/**
 * A therapist's own pre-vetted, reusable route options. This is the actual
 * safety control described by the spec: routes are never patient-chosen from
 * scratch, and a session may only ever offer routes drawn from a therapist's
 * OWN list here — there is no code path that lets a session reference an
 * arbitrary/unvetted route. The "3 options" a patient sees at booking time is
 * a real choice, but bounded entirely by what the therapist already approved
 * for their own safety (well-lit, populated, cell-coverage-verified, etc. —
 * the actual vetting is a manual admin/therapist step outside this code).
 */

export interface CreateSafeRouteInput {
  therapistId: string;
  name: string;
  zoneId?: string | null;
  estimatedDurationMinutes: number;
}

export async function createSafeRoute(input: CreateSafeRouteInput): Promise<TherapistSafeRoute> {
  if (!input.name || !input.name.trim()) badRequest("Route name is required");
  if (!Number.isInteger(input.estimatedDurationMinutes) || input.estimatedDurationMinutes <= 0) {
    badRequest("estimatedDurationMinutes must be a positive integer");
  }
  const therapist = await prisma.therapist.findUnique({ where: { id: input.therapistId } });
  if (!therapist) notFound(`Therapist ${input.therapistId} not found`);

  return prisma.therapistSafeRoute.create({
    data: {
      therapistId: input.therapistId,
      name: input.name,
      zoneId: input.zoneId ?? null,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
    },
  });
}

export async function listSafeRoutesForTherapist(therapistId: string): Promise<TherapistSafeRoute[]> {
  return prisma.therapistSafeRoute.findMany({
    where: { therapistId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deactivateSafeRoute(id: string): Promise<TherapistSafeRoute> {
  const route = await prisma.therapistSafeRoute.findUnique({ where: { id } });
  if (!route) notFound(`Safe route ${id} not found`);
  return prisma.therapistSafeRoute.update({ where: { id }, data: { active: false } });
}

/**
 * Picks up to 3 of a therapist's own active safe routes, ordered by how
 * closely their estimatedDurationMinutes matches the target session length.
 * Never returns a route belonging to a different therapist and never
 * fabricates one — a therapist with fewer than 3 active routes configured
 * simply offers fewer options (requestSession requires at least one).
 */
export async function pickRouteOffers(
  therapistId: string,
  targetDurationMinutes: number
): Promise<TherapistSafeRoute[]> {
  const routes = await prisma.therapistSafeRoute.findMany({
    where: { therapistId, active: true },
  });
  return routes
    .sort(
      (a, b) =>
        Math.abs(a.estimatedDurationMinutes - targetDurationMinutes) -
        Math.abs(b.estimatedDurationMinutes - targetDurationMinutes)
    )
    .slice(0, 3);
}
