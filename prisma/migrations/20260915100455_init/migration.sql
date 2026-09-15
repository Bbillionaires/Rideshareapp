-- CreateEnum
CREATE TYPE "ZoneColor" AS ENUM ('RED', 'GREEN', 'BLUE', 'YELLOW', 'BROWN');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('GAS', 'HYBRID', 'PHEV', 'EV');

-- CreateEnum
CREATE TYPE "VehicleApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('RIDER', 'DRIVER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RideOfferResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EvFundingSource" AS ENUM ('PLATFORM', 'RIDER', 'SPONSOR', 'SPLIT');

-- CreateEnum
CREATE TYPE "SponsorshipContributionType" AS ENUM ('FLAT_PER_TRIP', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "SponsorshipProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DISCONTINUED', 'RECALLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentMethod" AS ENUM ('SHIP', 'PICKUP', 'DIGITAL');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "DriverSaleStatus" AS ENUM ('COMPLETED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('DRIVER', 'RIDER', 'ADVERTISER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdPlacementSlot" AS ENUM ('RIDER_APP_HOME', 'DRIVER_APP_HOME', 'TRIP_WAITING_SCREEN', 'DRIVER_APPROACHING_SCREEN', 'DURING_TRIP_SCREEN', 'POST_TRIP_SCREEN', 'RECEIPT_SCREEN', 'MARKETPLACE', 'PROMOTIONAL_NOTIFICATION');

-- CreateEnum
CREATE TYPE "AdCreativeType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "AdTargetScope" AS ENUM ('ENTIRE_MARKET', 'ZONE', 'ZIP', 'RADIUS');

-- CreateEnum
CREATE TYPE "AdViewerType" AS ENUM ('RIDER', 'DRIVER');

-- CreateEnum
CREATE TYPE "AdConsentType" AS ENUM ('PERSONALIZED_OFFERS', 'NON_PERSONALIZED_ADVERTISING');

-- CreateEnum
CREATE TYPE "AdConsentStatus" AS ENUM ('GRANTED', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BoundedModule" AS ENUM ('RIDES', 'DISPATCH', 'PRICING', 'EV_INCENTIVES', 'COMMERCE', 'DRIVER_INVENTORY', 'ADVERTISING', 'AD_CONSENT', 'SPONSORSHIPS', 'PAYMENTS', 'DRIVER_EARNINGS');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('RIDE_FARE_RIDER_CHARGE', 'RIDE_BASE_DRIVER_EARNINGS', 'RIDE_EV_SUPPLEMENT', 'RIDE_SPONSORED_BONUS', 'PLATFORM_SERVICE_FEE', 'DRIVER_STORE_PURCHASE_REVENUE', 'DRIVER_STORE_PURCHASE_COGS', 'DRIVER_SALE_RIDER_CHARGE', 'DRIVER_SALE_DRIVER_COMMISSION', 'DRIVER_SALE_PLATFORM_PROFIT', 'AD_CAMPAIGN_SPEND', 'AD_REVENUE', 'SPONSORSHIP_CONTRIBUTION', 'REFUND');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerPartyType" AS ENUM ('PLATFORM', 'DRIVER', 'RIDER', 'ADVERTISER', 'SPONSOR');

-- CreateEnum
CREATE TYPE "DriverEarningsLineType" AS ENUM ('RIDE_BASE', 'EV_SUPPLEMENT', 'SPONSORED_BONUS', 'COMMERCE_COMMISSION');

-- CreateEnum
CREATE TYPE "RiderReceiptLineType" AS ENUM ('BASE_FARE', 'EV_SUPPLEMENT_CHARGE', 'SERVICE_FEE', 'PRODUCT_PURCHASE', 'PROMO_DISCOUNT');

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "ZoneColor" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zip_zone_mappings" (
    "id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zip_zone_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "plate" TEXT NOT NULL,
    "fuelType" "FuelType" NOT NULL,
    "approvalStatus" "VehicleApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "marketId" TEXT NOT NULL,
    "zoneId" TEXT,
    "pickupZip" TEXT,
    "serviceTypeId" TEXT NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'REQUESTED',
    "distanceMiles" DECIMAL(8,2),
    "durationMinutes" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "CancelledBy",
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_offers" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "response" "RideOfferResponse" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "ride_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_online_sessions" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "marketId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,

    CONSTRAINT "driver_online_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging_sessions" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,

    CONSTRAINT "charging_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_fares" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseFareCents" INTEGER NOT NULL,
    "distanceFareCents" INTEGER NOT NULL,
    "timeFareCents" INTEGER NOT NULL,
    "surgeMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "subtotalFareCents" INTEGER NOT NULL,
    "platformServiceFeeCents" INTEGER NOT NULL,
    "riderTotalChargeCents" INTEGER NOT NULL,
    "driverBaseEarningsCents" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_fares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_compensation_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "marketId" TEXT,
    "serviceTypeId" TEXT,
    "flatAmountCents" INTEGER,
    "percentageRate" DECIMAL(6,4),
    "perMileAmountCents" INTEGER,
    "minimumBonusAmountCents" INTEGER,
    "fundingSource" "EvFundingSource" NOT NULL DEFAULT 'PLATFORM',
    "splitConfig" JSONB,
    "sponsorshipProgramId" TEXT,
    "isPromotional" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveStartDate" TIMESTAMP(3) NOT NULL,
    "effectiveEndDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ev_compensation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_bonus_line_items" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleNameSnapshot" TEXT NOT NULL,
    "isPromotional" BOOLEAN NOT NULL,
    "flatComponentCents" INTEGER NOT NULL DEFAULT 0,
    "percentageComponentCents" INTEGER NOT NULL DEFAULT 0,
    "perMileComponentCents" INTEGER NOT NULL DEFAULT 0,
    "minimumFloorAppliedCents" INTEGER,
    "totalAmountCents" INTEGER NOT NULL,
    "fundingSource" "EvFundingSource" NOT NULL,
    "fundedByPlatformCents" INTEGER NOT NULL DEFAULT 0,
    "fundedByRiderCents" INTEGER NOT NULL DEFAULT 0,
    "fundedBySponsorCents" INTEGER NOT NULL DEFAULT 0,
    "sponsorshipContributionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ev_bonus_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsorship_programs" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contributionType" "SponsorshipContributionType" NOT NULL,
    "contributionAmountCents" INTEGER,
    "contributionPercentage" DECIMAL(6,4),
    "evOnly" BOOLEAN NOT NULL DEFAULT true,
    "marketId" TEXT,
    "serviceTypeId" TEXT,
    "budgetTotalCents" INTEGER NOT NULL,
    "budgetSpentCents" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "SponsorshipProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsorship_contributions" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsorship_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "ageRestricted" BOOLEAN NOT NULL DEFAULT false,
    "regulatedCategory" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "platformCostCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "resaleEligible" BOOLEAN NOT NULL DEFAULT false,
    "requiresSealedPackaging" BOOLEAN NOT NULL DEFAULT true,
    "ageRestricted" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "buyerDriverId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "bundleId" TEXT,
    "skuSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "FulfillmentMethod" NOT NULL,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "type" "CommissionType" NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveEnd" TIMESTAMP(3),

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_sales" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitSalePriceCents" INTEGER NOT NULL,
    "totalSalePriceCents" INTEGER NOT NULL,
    "unitPlatformCostCents" INTEGER NOT NULL,
    "totalPlatformCostCents" INTEGER NOT NULL,
    "driverCommissionCents" INTEGER NOT NULL,
    "platformProfitCents" INTEGER NOT NULL,
    "paymentId" TEXT,
    "status" "DriverSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_inventory_items" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "isAvailableForSale" BOOLEAN NOT NULL DEFAULT true,
    "lastRestockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "payerType" "PayerType" NOT NULL,
    "payerId" TEXT NOT NULL,
    "orderId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL,
    "processorRef" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedBy" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetTotalCents" INTEGER NOT NULL,
    "budgetSpentCents" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "frequencyCapCount" INTEGER,
    "frequencyCapPeriod" TEXT,
    "destinationUrl" TEXT,
    "promoCode" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "AdCreativeType" NOT NULL,
    "assetUrl" TEXT NOT NULL,
    "headline" TEXT,
    "bodyText" TEXT,
    "ctaLabel" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaign_placements" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "placement" "AdPlacementSlot" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ad_campaign_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_target_rules" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "scope" "AdTargetScope" NOT NULL,
    "marketId" TEXT,
    "zoneId" TEXT,
    "zip" TEXT,
    "radiusCenterLat" DECIMAL(9,6),
    "radiusCenterLng" DECIMAL(9,6),
    "radiusMiles" DECIMAL(6,2),

    CONSTRAINT "ad_target_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_impressions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "placement" "AdPlacementSlot" NOT NULL,
    "viewerType" "AdViewerType" NOT NULL,
    "viewerId" TEXT NOT NULL,
    "marketId" TEXT,
    "zoneId" TEXT,
    "zip" TEXT,
    "isUniqueForViewer" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_clicks" (
    "id" TEXT NOT NULL,
    "impressionId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_conversions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "conversionType" TEXT NOT NULL,
    "referenceId" TEXT,
    "amountCents" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "promoCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userType" "AdViewerType" NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceId" TEXT,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_consent_records" (
    "id" TEXT NOT NULL,
    "driverId" TEXT,
    "riderId" TEXT,
    "consentType" "AdConsentType" NOT NULL,
    "status" "AdConsentStatus" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "sourceScreen" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tos_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userType" "AdViewerType" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tos_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "sourceModule" "BoundedModule" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "partyType" "LedgerPartyType" NOT NULL,
    "partyId" TEXT,
    "driverId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "rideId" TEXT,
    "orderId" TEXT,
    "driverSaleId" TEXT,
    "evBonusLineItemId" TEXT,
    "sponsorshipContributionId" TEXT,
    "adCampaignId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings_lines" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "rideId" TEXT,
    "lineType" "DriverEarningsLineType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT,
    "ledgerEntryId" TEXT NOT NULL,
    "evBonusLineItemId" TEXT,
    "driverSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_earnings_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_receipt_lines" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "lineType" "RiderReceiptLineType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT,
    "ledgerEntryId" TEXT NOT NULL,
    "evBonusLineItemId" TEXT,
    "driverSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "markets_name_key" ON "markets"("name");

-- CreateIndex
CREATE UNIQUE INDEX "markets_code_key" ON "markets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "zones_marketId_name_key" ON "zones"("marketId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "zip_zone_mappings_zip_key" ON "zip_zone_mappings"("zip");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_code_key" ON "service_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_email_key" ON "drivers"("email");

-- CreateIndex
CREATE INDEX "vehicles_driverId_idx" ON "vehicles"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "riders_email_key" ON "riders"("email");

-- CreateIndex
CREATE INDEX "rides_driverId_idx" ON "rides"("driverId");

-- CreateIndex
CREATE INDEX "rides_riderId_idx" ON "rides"("riderId");

-- CreateIndex
CREATE INDEX "rides_status_idx" ON "rides"("status");

-- CreateIndex
CREATE INDEX "ride_offers_driverId_idx" ON "ride_offers"("driverId");

-- CreateIndex
CREATE INDEX "driver_online_sessions_driverId_idx" ON "driver_online_sessions"("driverId");

-- CreateIndex
CREATE INDEX "charging_sessions_vehicleId_idx" ON "charging_sessions"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "ride_fares_rideId_key" ON "ride_fares"("rideId");

-- CreateIndex
CREATE INDEX "ev_compensation_rules_marketId_serviceTypeId_active_idx" ON "ev_compensation_rules"("marketId", "serviceTypeId", "active");

-- CreateIndex
CREATE INDEX "ev_bonus_line_items_rideId_idx" ON "ev_bonus_line_items"("rideId");

-- CreateIndex
CREATE INDEX "sponsorship_contributions_programId_idx" ON "sponsorship_contributions"("programId");

-- CreateIndex
CREATE INDEX "sponsorship_contributions_rideId_idx" ON "sponsorship_contributions"("rideId");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_resaleEligible_idx" ON "products"("resaleEligible");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_code_key" ON "discounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_items_bundleId_productId_key" ON "bundle_items"("bundleId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_name_key" ON "inventory_locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_productId_locationId_key" ON "inventory_stock"("productId", "locationId");

-- CreateIndex
CREATE INDEX "orders_buyerDriverId_idx" ON "orders"("buyerDriverId");

-- CreateIndex
CREATE INDEX "driver_sales_driverId_idx" ON "driver_sales"("driverId");

-- CreateIndex
CREATE INDEX "driver_sales_riderId_idx" ON "driver_sales"("riderId");

-- CreateIndex
CREATE INDEX "driver_sales_rideId_idx" ON "driver_sales"("rideId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_inventory_items_driverId_productId_key" ON "driver_inventory_items"("driverId", "productId");

-- CreateIndex
CREATE INDEX "ad_campaigns_advertiserId_status_idx" ON "ad_campaigns"("advertiserId", "status");

-- CreateIndex
CREATE INDEX "ad_creatives_campaignId_active_idx" ON "ad_creatives"("campaignId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaign_placements_campaignId_placement_key" ON "ad_campaign_placements"("campaignId", "placement");

-- CreateIndex
CREATE INDEX "ad_target_rules_campaignId_idx" ON "ad_target_rules"("campaignId");

-- CreateIndex
CREATE INDEX "ad_impressions_campaignId_occurredAt_idx" ON "ad_impressions"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "ad_impressions_viewerId_idx" ON "ad_impressions"("viewerId");

-- CreateIndex
CREATE INDEX "ad_clicks_campaignId_occurredAt_idx" ON "ad_clicks"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "ad_conversions_campaignId_occurredAt_idx" ON "ad_conversions"("campaignId", "occurredAt");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_campaignId_idx" ON "promo_code_redemptions"("campaignId");

-- CreateIndex
CREATE INDEX "ad_consent_records_driverId_idx" ON "ad_consent_records"("driverId");

-- CreateIndex
CREATE INDEX "ad_consent_records_riderId_idx" ON "ad_consent_records"("riderId");

-- CreateIndex
CREATE INDEX "ledger_entries_partyType_partyId_idx" ON "ledger_entries"("partyType", "partyId");

-- CreateIndex
CREATE INDEX "ledger_entries_driverId_idx" ON "ledger_entries"("driverId");

-- CreateIndex
CREATE INDEX "ledger_entries_rideId_idx" ON "ledger_entries"("rideId");

-- CreateIndex
CREATE INDEX "ledger_entries_entryType_idx" ON "ledger_entries"("entryType");

-- CreateIndex
CREATE INDEX "driver_earnings_lines_driverId_idx" ON "driver_earnings_lines"("driverId");

-- CreateIndex
CREATE INDEX "driver_earnings_lines_rideId_idx" ON "driver_earnings_lines"("rideId");

-- CreateIndex
CREATE INDEX "rider_receipt_lines_rideId_idx" ON "rider_receipt_lines"("rideId");

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zip_zone_mappings" ADD CONSTRAINT "zip_zone_mappings_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "service_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_online_sessions" ADD CONSTRAINT "driver_online_sessions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_online_sessions" ADD CONSTRAINT "driver_online_sessions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_online_sessions" ADD CONSTRAINT "driver_online_sessions_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_fares" ADD CONSTRAINT "ride_fares_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_compensation_rules" ADD CONSTRAINT "ev_compensation_rules_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_compensation_rules" ADD CONSTRAINT "ev_compensation_rules_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_compensation_rules" ADD CONSTRAINT "ev_compensation_rules_sponsorshipProgramId_fkey" FOREIGN KEY ("sponsorshipProgramId") REFERENCES "sponsorship_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_bonus_line_items" ADD CONSTRAINT "ev_bonus_line_items_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_bonus_line_items" ADD CONSTRAINT "ev_bonus_line_items_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ev_compensation_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_bonus_line_items" ADD CONSTRAINT "ev_bonus_line_items_sponsorshipContributionId_fkey" FOREIGN KEY ("sponsorshipContributionId") REFERENCES "sponsorship_contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_programs" ADD CONSTRAINT "sponsorship_programs_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "sponsors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_programs" ADD CONSTRAINT "sponsorship_programs_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_programs" ADD CONSTRAINT "sponsorship_programs_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "service_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_contributions" ADD CONSTRAINT "sponsorship_contributions_programId_fkey" FOREIGN KEY ("programId") REFERENCES "sponsorship_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_contributions" ADD CONSTRAINT "sponsorship_contributions_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerDriverId_fkey" FOREIGN KEY ("buyerDriverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_sales" ADD CONSTRAINT "driver_sales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_sales" ADD CONSTRAINT "driver_sales_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_sales" ADD CONSTRAINT "driver_sales_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_sales" ADD CONSTRAINT "driver_sales_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_sales" ADD CONSTRAINT "driver_sales_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_inventory_items" ADD CONSTRAINT "driver_inventory_items_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_inventory_items" ADD CONSTRAINT "driver_inventory_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_placements" ADD CONSTRAINT "ad_campaign_placements_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_target_rules" ADD CONSTRAINT "ad_target_rules_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_target_rules" ADD CONSTRAINT "ad_target_rules_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_target_rules" ADD CONSTRAINT "ad_target_rules_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_impressionId_fkey" FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversions" ADD CONSTRAINT "ad_conversions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_consent_records" ADD CONSTRAINT "ad_consent_records_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_consent_records" ADD CONSTRAINT "ad_consent_records_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_driverSaleId_fkey" FOREIGN KEY ("driverSaleId") REFERENCES "driver_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_evBonusLineItemId_fkey" FOREIGN KEY ("evBonusLineItemId") REFERENCES "ev_bonus_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sponsorshipContributionId_fkey" FOREIGN KEY ("sponsorshipContributionId") REFERENCES "sponsorship_contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings_lines" ADD CONSTRAINT "driver_earnings_lines_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings_lines" ADD CONSTRAINT "driver_earnings_lines_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings_lines" ADD CONSTRAINT "driver_earnings_lines_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings_lines" ADD CONSTRAINT "driver_earnings_lines_evBonusLineItemId_fkey" FOREIGN KEY ("evBonusLineItemId") REFERENCES "ev_bonus_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings_lines" ADD CONSTRAINT "driver_earnings_lines_driverSaleId_fkey" FOREIGN KEY ("driverSaleId") REFERENCES "driver_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_receipt_lines" ADD CONSTRAINT "rider_receipt_lines_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_receipt_lines" ADD CONSTRAINT "rider_receipt_lines_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_receipt_lines" ADD CONSTRAINT "rider_receipt_lines_evBonusLineItemId_fkey" FOREIGN KEY ("evBonusLineItemId") REFERENCES "ev_bonus_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_receipt_lines" ADD CONSTRAINT "rider_receipt_lines_driverSaleId_fkey" FOREIGN KEY ("driverSaleId") REFERENCES "driver_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
