import { prisma } from "../../src/lib/prisma";
import { computeAndPostRideFare } from "../../src/modules/pricing/service";
import { applyEvBonusToRide, getEvBonusSummaryForRide } from "../../src/modules/ev-incentives/engine";
import {
  createCompletedRide,
  createEvVehicle,
  createGasVehicle,
  createTestDriver,
  createTestRider,
  disconnectDatabase,
  resetDatabase,
  seedBaseline,
} from "../helpers/db";

async function finalizeRide(ride: { id: string }) {
  const fresh = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
  await computeAndPostRideFare(fresh);
  await applyEvBonusToRide(fresh);
}

async function ledgerEntriesFor(rideId: string, entryType: string) {
  return prisma.ledgerEntry.findMany({ where: { rideId, entryType: entryType as never } });
}

describe("EV_INCENTIVES engine", () => {
  afterAll(disconnectDatabase);
  beforeEach(resetDatabase);

  it("applies no EV bonus to a non-EV vehicle even when a matching rule exists", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const vehicle = await createGasVehicle(driver.id, market.id);

    await prisma.evCompensationRule.create({
      data: {
        name: "JAX Standard EV Flat Bonus",
        marketId: market.id,
        serviceTypeId: standard.id,
        flatAmountCents: 200,
        fundingSource: "PLATFORM",
        effectiveStartDate: new Date(Date.now() - 86_400_000),
      },
    });

    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await finalizeRide(ride);

    const summary = await getEvBonusSummaryForRide(ride.id);
    expect(summary.totalEvBonusCents).toBe(0);
    expect(await ledgerEntriesFor(ride.id, "RIDE_EV_SUPPLEMENT")).toHaveLength(0);
  });

  it("applies a flat, platform-funded EV bonus on top of standard earnings ($18.50 + $2.00 example)", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const vehicle = await createEvVehicle(driver.id, market.id);

    await prisma.evCompensationRule.create({
      data: {
        name: "JAX Standard EV Flat Bonus",
        marketId: market.id,
        serviceTypeId: standard.id,
        flatAmountCents: 200,
        fundingSource: "PLATFORM",
        effectiveStartDate: new Date(Date.now() - 86_400_000),
      },
    });

    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await finalizeRide(ride);

    const fare = await prisma.rideFare.findUniqueOrThrow({ where: { rideId: ride.id } });
    const summary = await getEvBonusSummaryForRide(ride.id);
    expect(summary.totalEvBonusCents).toBe(200);
    expect(summary.lineItems[0].fundingSource).toBe("PLATFORM");

    const earningsLines = await prisma.driverEarningsLine.findMany({ where: { rideId: ride.id } });
    const totalDriverEarnings = earningsLines.reduce((sum, l) => sum + l.amountCents, 0);
    expect(totalDriverEarnings).toBe(fare.driverBaseEarningsCents + 200);

    // Platform absorbs the EV supplement: driver credited, platform debited,
    // rider's charge is untouched by the EV component.
    const driverCredit = await ledgerEntriesFor(ride.id, "RIDE_EV_SUPPLEMENT");
    expect(driverCredit).toHaveLength(2); // driver CREDIT + platform DEBIT
    const riderReceiptEvLines = await prisma.riderReceiptLine.findMany({
      where: { rideId: ride.id, lineType: "EV_SUPPLEMENT_CHARGE" },
    });
    expect(riderReceiptEvLines).toHaveLength(0); // rider funds none of it
  });

  it("stacks a promotional rule additively on top of the base rule", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const vehicle = await createEvVehicle(driver.id, market.id);

    await prisma.evCompensationRule.create({
      data: {
        name: "Base EV Bonus",
        marketId: market.id,
        serviceTypeId: standard.id,
        flatAmountCents: 200,
        fundingSource: "PLATFORM",
        effectiveStartDate: new Date(Date.now() - 86_400_000),
      },
    });
    await prisma.evCompensationRule.create({
      data: {
        name: "Launch Week Promo",
        marketId: market.id,
        serviceTypeId: standard.id,
        flatAmountCents: 100,
        fundingSource: "PLATFORM",
        isPromotional: true,
        effectiveStartDate: new Date(Date.now() - 86_400_000),
      },
    });

    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await finalizeRide(ride);

    const summary = await getEvBonusSummaryForRide(ride.id);
    expect(summary.totalEvBonusCents).toBe(300);
    expect(summary.lineItems).toHaveLength(2);
  });

  it("floors the bonus at minimumBonusAmountCents when the computed components fall short", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const vehicle = await createEvVehicle(driver.id, market.id);

    await prisma.evCompensationRule.create({
      data: {
        name: "Per-mile EV supplement with floor",
        marketId: market.id,
        serviceTypeId: standard.id,
        perMileAmountCents: 10, // 10 cents/mile * 5 miles = 50 cents, below the floor
        minimumBonusAmountCents: 150,
        fundingSource: "PLATFORM",
        effectiveStartDate: new Date(Date.now() - 86_400_000),
      },
    });

    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      marketId: market.id,
      serviceTypeId: standard.id,
      distanceMiles: 5,
    });
    await finalizeRide(ride);

    const summary = await getEvBonusSummaryForRide(ride.id);
    expect(summary.totalEvBonusCents).toBe(150);
    expect(summary.lineItems[0].minimumFloorAppliedCents).toBe(150);
  });

  it("reconciles a sponsor-funded rule against the program's own contracted rate, absorbing the gap onto the platform", async () => {
    const { market, standard } = await seedBaseline();
    const driver = await createTestDriver();
    const rider = await createTestRider();
    const vehicle = await createEvVehicle(driver.id, market.id);

    const sponsor = await prisma.sponsor.create({ data: { name: "Acme EV Dealership" } });
    const program = await prisma.sponsorshipProgram.create({
      data: {
        sponsorId: sponsor.id,
        name: "EV DRIVER BONUS — Sponsored by Acme",
        contributionType: "FLAT_PER_TRIP",
        contributionAmountCents: 200, // sponsor contracted for $2.00/trip
        budgetTotalCents: 100_000,
        startDate: new Date(Date.now() - 86_400_000),
        status: "ACTIVE",
      },
    });
    const rule = await prisma.evCompensationRule.create({
      data: {
        name: "Rule computes $2.50, program only contracted $2.00",
        marketId: market.id,
        serviceTypeId: standard.id,
        flatAmountCents: 250,
        fundingSource: "SPONSOR",
        sponsorshipProgramId: program.id,
        effectiveStartDate: new Date(Date.now() - 86_400_000),
      },
    });

    const ride = await createCompletedRide({
      riderId: rider.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      marketId: market.id,
      serviceTypeId: standard.id,
    });
    await finalizeRide(ride);

    const lineItem = await prisma.evBonusLineItem.findFirstOrThrow({ where: { rideId: ride.id } });
    // Driver still gets the full amount the rule promised...
    expect(lineItem.totalAmountCents).toBe(250);
    // ...but the sponsor is only billed what they actually contracted for...
    expect(lineItem.fundedBySponsorCents).toBe(200);
    // ...and the platform silently absorbs the $0.50 gap rather than it
    // vanishing untracked.
    expect(lineItem.fundedByPlatformCents).toBe(50);

    const contribution = await prisma.sponsorshipContribution.findFirstOrThrow({
      where: { rideId: ride.id },
    });
    expect(contribution.amountCents).toBe(200);
    expect(contribution.programId).toBe(program.id);

    const sponsorLedger = await prisma.ledgerEntry.findFirstOrThrow({
      where: { rideId: ride.id, entryType: "SPONSORSHIP_CONTRIBUTION" },
    });
    expect(sponsorLedger.amountCents).toBe(200);
    expect(sponsorLedger.partyId).toBe(sponsor.id);

    const updatedProgram = await prisma.sponsorshipProgram.findUniqueOrThrow({ where: { id: program.id } });
    expect(updatedProgram.budgetSpentCents).toBe(200);
    void rule;
  });
});
