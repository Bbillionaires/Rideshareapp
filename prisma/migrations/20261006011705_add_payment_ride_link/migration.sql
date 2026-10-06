-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "rideId" TEXT;

-- CreateIndex
CREATE INDEX "payments_rideId_idx" ON "payments"("rideId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;
