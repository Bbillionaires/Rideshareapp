import { PrismaClient, ZoneColor } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const jacksonville = await prisma.market.upsert({
    where: { code: "JAX" },
    update: {},
    create: { name: "Jacksonville", code: "JAX", timezone: "America/New_York" },
  });

  const zones: Array<{ name: string; color: ZoneColor }> = [
    { name: "Northside", color: ZoneColor.RED },
    { name: "Southside", color: ZoneColor.GREEN },
    { name: "Westside", color: ZoneColor.BLUE },
    { name: "Eastside / Beaches", color: ZoneColor.YELLOW },
    { name: "Downtown / Urban Core", color: ZoneColor.BROWN },
  ];

  for (const zone of zones) {
    await prisma.zone.upsert({
      where: { marketId_name: { marketId: jacksonville.id, name: zone.name } },
      update: { color: zone.color },
      create: { marketId: jacksonville.id, name: zone.name, color: zone.color },
    });
  }

  const serviceTypes = [
    { code: "STANDARD", name: "Standard" },
    { code: "XL", name: "XL" },
    { code: "PREMIUM", name: "Premium" },
  ];

  for (const st of serviceTypes) {
    await prisma.serviceType.upsert({
      where: { code: st.code },
      update: { name: st.name },
      create: st,
    });
  }

  const centralWarehouse = await prisma.inventoryLocation.upsert({
    where: { name: "Central Warehouse" },
    update: {},
    create: { name: "Central Warehouse" },
  });

  console.log("Seeded market:", jacksonville.name);
  console.log("Seeded zones:", zones.map((z) => `${z.name}=${z.color}`).join(", "));
  console.log("Seeded service types:", serviceTypes.map((s) => s.code).join(", "));
  console.log("Seeded inventory location:", centralWarehouse.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
