import { prisma } from "../../lib/prisma";

/**
 * EV_INCENTIVES eligibility check.
 *
 * EV eligibility for compensation purposes is ALWAYS derived from the
 * approved vehicle record — never from a driver self-selecting "I drive an
 * EV". A vehicle only counts as EV-eligible when all three hold:
 *   - fuelType === 'EV'
 *   - approvalStatus === 'APPROVED' (an admin has verified the vehicle)
 *   - active === true (not deactivated/retired)
 */
export async function isVehicleEvEligible(vehicleId: string): Promise<boolean> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { fuelType: true, approvalStatus: true, active: true },
  });
  if (!vehicle) return false;
  return vehicle.fuelType === "EV" && vehicle.approvalStatus === "APPROVED" && vehicle.active === true;
}
