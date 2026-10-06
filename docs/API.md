# RideshareApp API documentation

This documents every HTTP endpoint actually implemented in `src/`, grouped by
bounded module (see `README.md`'s Architecture section). It was written
directly from the route/service/schema source, not from the original spec —
if something here and the code ever disagree, the code is correct and this
file has drifted; please file that as a bug.

**Format choice**: plain Markdown, not an OpenAPI/Swagger YAML spec. This
repo has no existing API-spec tooling (no swagger-jsdoc, no generated
clients), the request/response shapes are plain TypeScript interfaces and
Prisma models readable directly from `src/modules/*/service.ts`, and the
project's own documentation convention is Markdown (`README.md`). A full
OpenAPI document would duplicate every field here in YAML with no consumer
in this codebase to benefit from it yet. If a generated client or a
Swagger UI becomes a real need later, this file is the source of truth to
convert from.

## Conventions

- **Base URL**: none configured — everything is mounted directly on the
  Express app (`src/index.ts`) at the paths below, served on `PORT` (default
  `3000`).
- **Content type**: send `Content-Type: application/json` with a JSON body
  for every `POST`/`PATCH`/`PUT`. Responses are always JSON.
- **IDs**: every ID (`rideId`, `driverId`, product IDs, etc.) is a Prisma
  `cuid()` string. There are no numeric/sequential IDs anywhere.
- **Money**: every amount is an **integer number of cents** (e.g. `1066` =
  \$10.66). Never a float/decimal dollar amount. See `src/lib/money.ts`.
- **Auth: there is none.** This codebase has no authentication system — no
  login endpoint, no sessions, no API keys, no bearer tokens, no per-role
  authorization checks. Every endpoint below trusts whatever
  `driverId`/`riderId`/etc. the caller supplies in the request. This is
  acceptable for the current test/sandbox MVP (see README "Status") but
  **must** be addressed (e.g. a real auth module + per-route authorization)
  before this is exposed to real users or real money. Treat every "Auth:"
  line below as documentation of this gap, not as an actual control.
- **Errors**: every error response is `{ "error": "<message>" }` with an
  HTTP status set by the module (`src/lib/http.ts`):
  - `400 Bad Request` — validation failure (`badRequest(...)`)
  - `404 Not Found` — referenced entity doesn't exist (`notFound(...)`)
  - `500 Internal Server Error` — unexpected/unhandled error
- **Success status codes**: `POST` that creates a row returns `201`; a
  `POST` that performs an action/transition (accept, start, pause, etc.)
  returns `200`; `DELETE`/"remove" endpoints that have no body to return use
  `204 No Content`; everything else is `200`.
- **Query filters**: optional filters are always plain query-string
  parameters (e.g. `?status=REQUESTED&marketId=...`); there is no cursor
  pagination anywhere yet — list endpoints return every matching row (a few
  cap at an internal `take` limit, noted where relevant).

## Table of contents

1. [Accounts](#accounts) — drivers, riders, vehicles, driver presence, reference data (added in this PR; see note below)
2. [Rides](#rides)
3. [Pricing](#pricing) (no endpoints — internal only)
4. [EV incentives](#ev-incentives)
5. [Sponsorships](#sponsorships)
6. [Commerce](#commerce) — catalog, orders, driver-to-rider resale
7. [Driver inventory](#driver-inventory)
8. [Payments](#payments) — incl. Stripe test-mode ride-fare settlement
9. [Advertising](#advertising)
10. [Ad consent](#ad-consent)
11. [Therapy rides](#therapy-rides)
12. [Ledger / driver earnings](#ledger--driver-earnings) (no endpoints — internal only)
13. [Health check](#health-check)

> **Note on Accounts**: `src/modules/accounts/` did not exist before this
> PR. Before it, there was no HTTP-reachable way to create a `Driver` or
> `Rider` row at all (only a raw Prisma call in test fixtures), which made
> it impossible to build the rider/driver web apps or run a real end-to-end
> test against the API. It is the minimum CRUD + driver-presence surface
> needed for that; it adds no authentication (see above).

---

## Accounts

Base path: `/accounts`. Backs `Driver`, `Rider`, `Vehicle`, and
`DriverOnlineSession` (schema module: IDENTITY / RIDES' `DriverOnlineSession`).

#### `POST /accounts/drivers`
Creates a driver.
- Body: `{ "name": string, "email": string }`
- Response `201`: the created `Driver` row.
- Errors: `400` if `name`/`email` missing.

#### `GET /accounts/drivers/:id`
- Response `200`: the `Driver` row, with `vehicles` included.
- Errors: `404` if not found.

#### `GET /accounts/drivers/:id/vehicles`
- Response `200`: `Vehicle[]` for that driver, newest first.

#### `POST /accounts/drivers/:id/online`
Starts a `DriverOnlineSession` (the driver is now "online").
- Body: `{ "marketId": string, "vehicleId"?: string }`
- Response `201`: the created `DriverOnlineSession` (`endedAt: null`).
- Errors: `400` if the driver already has an open session (one active
  session per driver at a time); `404` if the driver doesn't exist.

#### `POST /accounts/drivers/:id/offline`
Ends the driver's open online session and records `durationMinutes`.
- Response `200`: the closed `DriverOnlineSession`.
- Errors: `400` if the driver has no open session.

#### `GET /accounts/drivers/:id/status`
- Response `200`: `{ "online": boolean, "session": DriverOnlineSession | null }`

#### `POST /accounts/riders`
Creates a rider.
- Body: `{ "name": string, "email": string }`
- Response `201`: the created `Rider` row.
- Errors: `400` if `name`/`email` missing.

#### `GET /accounts/riders/:id`
- Response `200`: the `Rider` row.
- Errors: `404` if not found.

#### `POST /accounts/vehicles`
Creates a vehicle for a driver. **Note**: unlike the real spec's admin
review queue, this MVP endpoint creates the vehicle **pre-approved**
(`approvalStatus: APPROVED`, `verifiedAt: now()`) so a test driver can
immediately go online and (if `fuelType: EV`) qualify for EV bonuses — see
`src/modules/accounts/service.ts`'s comment and the EV incentives section
below for why `approvalStatus` matters.
- Body: `{ "driverId": string, "marketId": string, "make": string, "model": string, "year": number, "plate": string, "fuelType": "GAS"|"HYBRID"|"PHEV"|"EV" }`
- Response `201`: the created `Vehicle`.
- Errors: `400` on missing/invalid fields; `404` if `driverId`/`marketId` don't exist.

#### `GET /accounts/markets`
- Response `200`: active `Market[]` (reference data for a frontend dropdown).

#### `GET /accounts/service-types`
- Response `200`: active `ServiceType[]` (reference data for a frontend dropdown).

---

## Rides

Base path: `/rides`. Backs the `Ride` model — trip lifecycle:
`REQUESTED → ACCEPTED → IN_PROGRESS → COMPLETED` (or `CANCELLED` from
`REQUESTED`/`ACCEPTED`).

#### `POST /rides`
Rider requests a ride.
- Body: `{ "riderId": string, "marketId": string, "serviceTypeId": string, "zoneId"?: string, "pickupZip"?: string }`
- Response `201`: the created `Ride` (`status: REQUESTED`).

#### `GET /rides`
Lists rides — powers both the **rider ride-history** view (`riderId` filter)
and the **driver available-rides** view (`status=REQUESTED` + `marketId`
filter); there's no separate dispatch/matching queue in this MVP.
- Query: `riderId?`, `driverId?`, `marketId?`, `status?` (`REQUESTED` |
  `ACCEPTED` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`), `limit?` (default
  50, max 100)
- Response `200`: `Ride[]`, each including `fare` and `payments`, newest
  (`requestedAt desc`) first.

#### `POST /rides/:id/accept`
A driver accepts a `REQUESTED` ride.
- Body: `{ "driverId": string, "vehicleId": string }`
- Response `200`: the updated `Ride` (`status: ACCEPTED`, `acceptedAt` set).
- Errors: `400` if the ride isn't `REQUESTED`; `404` if the ride doesn't exist.

#### `POST /rides/:id/start`
Marks a ride in progress (pickup complete).
- Response `200`: the updated `Ride` (`status: IN_PROGRESS`, `startedAt` set).

#### `POST /rides/:id/complete`
Completes the ride and triggers the full money-moving pipeline:
1. **PRICING** computes and posts the base fare (`RideFare` + ledger entries) — see [Pricing](#pricing).
2. **EV_INCENTIVES → SPONSORSHIPS → THERAPY_RIDES** completion hooks run, in that order (`src/modules/rides/hooks.ts`, wired in `src/bootstrap.ts`).
3. **PAYMENTS** settles the rider's charge via Stripe (test mode) — see [Payments](#payments). This step can never fail the request; any Stripe problem (or no key configured) is swallowed and logged, not thrown.
- Body: `{ "distanceMiles": number, "durationMinutes": number }`
- Response `200`: the updated `Ride` (`status: COMPLETED`, `completedAt`/`distanceMiles`/`durationMinutes` set). Fetch `GET /rides/:id` afterward for the fare/earnings/payment breakdown.

#### `POST /rides/:id/cancel`
- Body: `{ "cancelledBy": "RIDER"|"DRIVER"|"SYSTEM", "reason"?: string }`
- Response `200`: the updated `Ride` (`status: CANCELLED`).

#### `GET /rides/:id`
The full ride detail view — this is what both web apps poll.
- Response `200`: `Ride` including `fare`, `evBonusLineItems`,
  `sponsorContribs`, `driverSales`, `receiptLines` (rider-facing),
  `earningsLines` (driver-facing), and `payments` (Stripe settlement, if
  any).
- Errors: `404` if not found.

---

## Pricing

No HTTP endpoints — `src/modules/pricing/service.ts` runs internally as the
first step of `POST /rides/:id/complete`. Computes, per ride:

- `baseFareCents` (flat 250), `distanceFareCents` (120¢/mile),
  `timeFareCents` (25¢/min), `subtotalFareCents`, `platformServiceFeeCents`
  (20% of subtotal), `riderTotalChargeCents` (= subtotal, since there's no
  tax model yet), `driverBaseEarningsCents` (= subtotal − platform fee).
- Posts 3 `LedgerEntry` rows (rider charge DEBIT, driver earnings CREDIT,
  platform fee CREDIT) and one `RiderReceiptLine` (`BASE_FARE`).
- Idempotent: calling it twice for the same ride returns the existing
  `RideFare` without duplicating ledger entries.

Read the result via `GET /rides/:id` (`fare` field) or
`GET /ev-incentives/rides/:rideId/bonus` for the EV-specific breakdown.

---

## EV incentives

Base path: `/ev-incentives`. Admin CRUD for `EvCompensationRule` (the
admin-configurable EV bonus engine) plus EV-vs-non-EV analytics.

#### `GET /ev-incentives/analytics`
- Query: `from?`, `to?` (ISO dates), `marketId?`, `driverId?`
- Response `200`: comparison of EV vs non-EV driver trip/earnings metrics
  over the window (see `EvComparisonResult` in `analytics.ts`).

#### `GET /ev-incentives/rides/:rideId/bonus`
- Response `200`: the EV bonus breakdown for one ride (which rule(s)
  applied, amounts, funding split) — see `getRideBonusBreakdown`.

#### `POST /ev-incentives/rules`
Creates an `EvCompensationRule`.
- Body (`EvRuleInput`):
  ```json
  {
    "name": "string",
    "description": "string | null",
    "marketId": "string | null",
    "serviceTypeId": "string | null",
    "flatAmountCents": "number | null",
    "percentageRate": "number | null (0-1)",
    "perMileAmountCents": "number | null",
    "minimumBonusAmountCents": "number | null",
    "fundingSource": "PLATFORM | RIDER | SPONSOR | SPLIT",
    "splitConfig": { "platform": 0.5, "sponsor": 0.5 },
    "sponsorshipProgramId": "string | null",
    "isPromotional": false,
    "priority": 0,
    "effectiveStartDate": "ISO date (required)",
    "effectiveEndDate": "ISO date | null",
    "active": true,
    "createdBy": "string | null"
  }
  ```
- Response `201`: the created rule.
- Errors `400`: no name/`effectiveStartDate`; none of
  flat/percentage/per-mile set; `percentageRate` outside `[0,1]`;
  `fundingSource: SPONSOR` without `sponsorshipProgramId`;
  `fundingSource: SPLIT` without a `splitConfig` summing to `1`;
  `effectiveEndDate` before `effectiveStartDate`.

#### `GET /ev-incentives/rules`
- Query: `marketId?`, `serviceTypeId?`, `active?` (`"true"`/`"false"`), `isPromotional?`
- Response `200`: matching `EvCompensationRule[]`.

#### `GET /ev-incentives/rules/:id`
- Response `200`: one rule. Errors: `404`.

#### `PATCH /ev-incentives/rules/:id`
- Body: any subset of `EvRuleInput`.
- Response `200`: the updated rule. Same `400` validations as create.

#### `POST /ev-incentives/rules/:id/deactivate`
- Response `200`: the rule with `active: false`.

**EV eligibility** is derived only from the ride's `Vehicle` record
(`fuelType === 'EV' && approvalStatus === 'APPROVED' && active`) — never
from a driver-supplied flag (`src/modules/ev-incentives/eligibility.ts`).

---

## Sponsorships

Base path: `/sponsorships`. Admin CRUD for `Sponsor` and
`SponsorshipProgram` (business-sponsored driver incentive programs), plus a
read view of posted contributions.

#### `POST /sponsorships/sponsors`
- Body: `{ "name": string, "contactEmail"?: string | null }`
- Response `201`: the created `Sponsor`.

#### `GET /sponsorships/sponsors`
- Response `200`: `Sponsor[]`.

#### `GET /sponsorships/sponsors/:id`
- Response `200`: one `Sponsor`. Errors: `404`.

#### `PATCH /sponsorships/sponsors/:id`
- Body: partial `{ name?, contactEmail? }`.
- Response `200`: the updated `Sponsor`.

#### `POST /sponsorships/programs`
Creates a `SponsorshipProgram`.
- Body (`CreateProgramInput`):
  ```json
  {
    "sponsorId": "string (required)",
    "name": "string (required)",
    "description": "string | null",
    "contributionType": "FLAT_PER_TRIP | PERCENTAGE",
    "contributionAmountCents": "number | null (required if FLAT_PER_TRIP)",
    "contributionPercentage": "number | null (required if PERCENTAGE)",
    "evOnly": false,
    "marketId": "string | null",
    "serviceTypeId": "string | null",
    "budgetTotalCents": "number (required, >= 0)",
    "startDate": "ISO date (required)",
    "endDate": "ISO date | null",
    "status": "DRAFT | ACTIVE | PAUSED | ... (SponsorshipProgramStatus)"
  }
  ```
- Response `201`: the created program.

#### `GET /sponsorships/programs`
- Query: `sponsorId?`, `status?`
- Response `200`: matching `SponsorshipProgram[]`.

#### `GET /sponsorships/programs/:id`
- Response `200`: one program. Errors: `404`.

#### `PATCH /sponsorships/programs/:id`
- Body: partial `CreateProgramInput`.
- Response `200`: the updated program.

#### `GET /sponsorships/programs/:id/contributions`
- Response `200`: `SponsorshipContribution[]` posted against that program
  (each tied to a ride + ledger entry).

---

## Commerce

Base path: `/commerce`. The in-app driver store catalog/orders, plus
driver-to-rider resale. All money movement goes through
[Payments](#payments) + the ledger, never a bespoke amount field.

### Catalog (admin)

#### `POST /commerce/categories`
- Body: `{ "name": string, "slug": string, "description"?: string, "ageRestricted"?: boolean, "regulatedCategory"?: boolean }`
- Response `201`: the created `ProductCategory`.

#### `GET /commerce/categories`
- Response `200`: `ProductCategory[]`, alphabetical.

#### `PATCH /commerce/categories/:id`
- Body: partial of the create body, plus `active?: boolean`.
- Response `200`: the updated category.

#### `POST /commerce/products`
- Body (`CreateProductInput`): `{ "sku": string, "name": string, "description"?: string, "categoryId": string, "priceCents": number, "platformCostCents": number, "currency"?: string, "resaleEligible"?: boolean, "requiresSealedPackaging"?: boolean (default true), "ageRestricted"?: boolean, "expiresAt"?: ISO date, "createdBy"?: string }`
- Response `201`: the created `Product`.
- Errors: `404` if `categoryId` doesn't exist; `400` if `resaleEligible: true` is requested for a product that fails the resale-eligibility gate (age-restricted or in a `regulatedCategory` — alcohol/tobacco/cannabis/prescription/weapons can never be resale-eligible).

#### `GET /commerce/products`
- Query: `status?` (`ProductStatus`), `categoryId?`, `resaleEligible?` (`"true"`/`"false"`)
- Response `200`: matching `Product[]`.

#### `GET /commerce/products/:id`
- Response `200`: one `Product`. Errors: `404`.

#### `PATCH /commerce/products/:id`
Covers price changes, disabling (`status: DISABLED`), recalling
(`status: RECALLED`), toggling `resaleEligible`/`requiresSealedPackaging`.
- Body: partial `UpdateProductInput`.
- Response `200`: the updated product.

#### `POST /commerce/products/:id/images`
- Body: `{ "url": string, "altText"?: string, "sortOrder"?: number }` (see `AddProductImageInput`)
- Response `201`: the created `ProductImage`.

#### `DELETE /commerce/products/:id/images/:imageId`
- Response `200`: the removed image record (not `204` — see route source).

#### `POST /commerce/discounts`
- Body (`CreateDiscountInput`): `{ "code"?: string, "name": string, "type": "PERCENTAGE"|"FIXED_AMOUNT", "value": number, "productId"?: string, "categoryId"?: string, "startsAt": ISO date, "endsAt"?: ISO date, "usageLimit"?: number }`. `value` is a 0–1 rate for `PERCENTAGE`, whole cents for `FIXED_AMOUNT`.
- Response `201`: the created `Discount`.
- Errors: `404` if `productId`/`categoryId` given but not found; `400` if `value` isn't properly bounded.
- **Note**: only automatic (no-code) discounts are auto-applied at checkout today; explicit discount-code redemption is stored/validated here but not yet wired into `placeOrder`.

#### `GET /commerce/discounts`
- Query: `productId?`, `categoryId?`, `active?`
- Response `200`: matching `Discount[]`.

#### `POST /commerce/commission-rules`
Driver-to-rider resale commission configuration.
- Body (`CreateCommissionRuleInput`): `{ "productId"?: string, "categoryId"?: string (one of the two required), "type": "PERCENTAGE"|"FLAT", "value": number, "effectiveStart"?: ISO date, "effectiveEnd"?: ISO date }`. `PERCENTAGE` `value` is bounded to `[0,1]` of gross margin; `FLAT` is cents/unit, must be `>= 0`.
- Response `201`: the created `CommissionRule`.

#### `GET /commerce/commission-rules`
- Query: `productId?`, `categoryId?`, `active?`
- Response `200`: matching `CommissionRule[]`.

#### `PATCH /commerce/commission-rules/:id`
- Body: partial `CreateCommissionRuleInput`.
- Response `200`: the updated rule.

#### `POST /commerce/commission-rules/:id/deactivate`
- Response `200`: the rule with `active: false`.

#### `POST /commerce/bundles`
- Body: `{ "name": string, "description"?: string, "priceCents": number, "items": [{ "productId": string, "quantity": number }, ...] }`
- Response `201`: the created `Bundle`.

#### `GET /commerce/bundles`
- Response `200`: `Bundle[]`.

#### `POST /commerce/inventory-locations`
- Body: `{ "name": string }`
- Response `201`: the created `InventoryLocation`.

#### `GET /commerce/inventory-locations`
- Response `200`: `InventoryLocation[]`.

#### `POST /commerce/inventory-stock/:productId/:locationId`
Adjusts warehouse stock (admin restocking the platform's own inventory —
distinct from [Driver inventory](#driver-inventory)).
- Body: `{ "quantityOnHand"?: number, "quantityReserved"?: number, "reorderThreshold"?: number }`
- Response `200`: the updated `InventoryStock`.

#### `GET /commerce/inventory-stock/:productId`
- Response `200`: `InventoryStock` rows for that product across locations.

### Orders (driver buying from the store)

#### `POST /commerce/orders`
- Body (`PlaceOrderInput`): `{ "buyerDriverId": string, "items": [{ "productId"?: string, "bundleId"?: string, "quantity": number }, ...], "locationId"?: string }`
- Response `201`: the created `Order` (with its `Payment` created via
  [Payments](#payments), discounts auto-applied, inventory decremented).

#### `GET /commerce/orders`
- Query: `buyerDriverId?`, `status?`, `startDate?`, `endDate?`
- Response `200`: matching `Order[]`.

#### `POST /commerce/orders/:id/refund`
- Body: `{ "amountCents": number, "reason"?: string, "issuedBy"?: string }`
- Response `200`: `{ "refund": Refund, "order": Order }`.
- Errors: `400` if the order has no payment, or the cumulative refund would exceed the payment amount.

#### `POST /commerce/orders/:id/fulfillments`
- Body (`CreateFulfillmentInput`): `{ "method": "SHIP"|"PICKUP" (FulfillmentMethod), "carrier"?: string, "trackingNumber"?: string }`
- Response `201`: the created `Fulfillment` (`status: PENDING`).

#### `PATCH /commerce/fulfillments/:id`
- Body: `{ "status": FulfillmentStatus, "carrier"?: string, "trackingNumber"?: string }`
- Response `200`: the updated `Fulfillment`.

#### `GET /commerce/analytics/sales`
- Query: `startDate?`, `endDate?`
- Response `200`: aggregated sales analytics for the driver store.

### Driver-to-rider resale

#### `GET /commerce/driver-sales/available/:driverId`
Powers the rider-facing "AVAILABLE FROM YOUR DRIVER" screen: only stock the
driver has on hand, marked available, `ACTIVE`, `resaleEligible`, and not
expired.
- Response `200`: `DriverInventoryItem[]` (with `product` included).

#### `POST /commerce/driver-sales`
The driver-to-rider resale transaction.
- Body: `{ "productId": string, "driverId": string, "riderId": string, "rideId": string, "quantity": number }`
- Response `201`: the created `DriverSale` (commission/profit split
  computed, rider charged via [Payments](#payments), inventory decremented,
  ledger entries posted — see `driver-sale.service.ts`).
- Errors: `400` if the product isn't `ACTIVE`/`resaleEligible`, is expired,
  age-restricted, or in a `regulatedCategory`; or if the driver lacks
  sufficient available stock.

#### `POST /commerce/driver-sales/:id/refund`
- Body: `{ "reason"?: string, "issuedBy"?: string }`
- Response `200`: the updated `DriverSale` (`status: REFUNDED`).
- Errors: `400` if already refunded or has no associated payment.

---

## Driver inventory

Base path: `/driver-inventory`. Per-driver on-hand stock for resale
(distinct from Commerce's warehouse `InventoryStock`).

#### `POST /driver-inventory/restock`
- Body: `{ "driverId": string, "productId": string, "quantity": number }`
- Response `201`: the upserted `DriverInventoryItem` (`quantityOnHand`
  incremented, `lastRestockedAt` updated).

#### `POST /driver-inventory/availability`
- Body: `{ "driverId": string, "productId": string, "isAvailableForSale": boolean }`
- Response `200`: the updated `DriverInventoryItem`.
- Errors: `404` if the driver has no inventory item for that product yet.

#### `GET /driver-inventory/:driverId`
Powers the driver-facing "MY INVENTORY: Water x8, Chips x5…" view.
- Response `200`: `DriverInventoryItem[]` (with a trimmed `product`
  projection), newest-updated first.

---

## Payments

No standalone CRUD routes of its own — `src/modules/payments/service.ts` is
called by other modules (Commerce orders, driver-to-rider resale, and now
Rides' Stripe settlement) from inside their own transactions. Documented
here because it's the one place every charge/refund in the system actually
lands (`Payment`/`Refund` tables).

- `createPayment(tx, input)` — generic payment record: `payerType`
  (`DRIVER`|`RIDER`|`ADVERTISER`), `payerId`, optional `orderId`/`rideId`,
  `amountCents`, `method` (free text, e.g. `CARD_ON_FILE`, `STRIPE_CARD`),
  optional `processorRef`, `status` (default `CAPTURED`).
- `issueRefund(tx, input)` — creates a `Refund` row, updates the
  `Payment.status` to `PARTIALLY_REFUNDED`/`REFUNDED` based on the
  cumulative refunded total (never allows over-refunding across multiple
  calls), and posts a `REFUND` ledger entry.

### Stripe ride-fare settlement (test mode) — new in this PR

`src/modules/payments/stripe.ts` + `ride-fare-payment.ts`. Triggered
automatically as the last step of `POST /rides/:id/complete` — there is no
separate endpoint to call. Read the outcome via `GET /rides/:id`'s
`payments` array or `GET /rides?riderId=...`.

**How it works:**
1. If `STRIPE_SECRET_KEY` is **not set**, nothing is attempted — no
   `Payment` row is created at all, and a warning is logged. This is the
   expected state unless a Stripe test key has been configured (see
   `.env.example` and the README "Status" section — this is currently
   blocked on a real Stripe account; see "Needs De'Aris" in the PR
   description).
2. If it **is set**, a Stripe `PaymentIntent` is created and confirmed
   immediately, for `RideFare.riderTotalChargeCents`, using Stripe's
   built-in always-succeeds test payment method token `pm_card_visa`. A
   `Payment` row is created:
   - `payerType: RIDER`, `payerId`: the ride's rider, `rideId`: the ride,
     `method: STRIPE_CARD`, `amountCents`: the fare.
   - On success: `status: CAPTURED`, `processorRef`: the PaymentIntent id
     (`pi_...`).
   - On any Stripe error (invalid/revoked key, network failure, etc.):
     `status: FAILED`, `processorRef: null`. The error itself is logged
     server-side, not stored (there's no free-text field on `Payment`).
3. **This never fails ride completion.** `POST /rides/:id/complete` always
   returns `200` with the ride `COMPLETED`, regardless of whether the
   Stripe step succeeded, failed, or was skipped.

**Known scope limitation**: this charges `RideFare.riderTotalChargeCents`
only — the base ride fare. It does **not** currently fold in a rider-funded
EV surcharge share (`SPLIT`/`RIDER` funding source — rare) or in-ride
driver-to-rider product purchases (`DriverSale`), which post their own
separate `Payment` rows today via the same generic `createPayment` path but
are not yet combined into one Stripe charge. See README "Status" → known
gaps.

**Test mode guarantee**: nothing in this codebase can switch Stripe into
live mode — that's entirely a property of which key you put in
`STRIPE_SECRET_KEY`. Only ever put a `sk_test_...` key there (see
`.env.example`). As a second, Stripe-enforced guarantee, the `pm_card_visa`
token used here is rejected outright by a live-mode key.

---

## Advertising

Base path: `/advertising`. Campaign/creative/targeting CRUD (admin
back-office) plus ad serving, impression/click/conversion tracking, and
aggregated analytics.

### Advertisers

#### `POST /advertising/advertisers`
- Body: `{ "name": string, "contactEmail"?: string | null }`
- Response `201`: the created `Advertiser`.

#### `GET /advertising/advertisers`
- Response `200`: `Advertiser[]`.

#### `PATCH /advertising/advertisers/:id`
- Body: `{ "name"?, "contactEmail"?, "status"? }`
- Response `200`: the updated `Advertiser`. Errors: `404`.

### Campaigns

#### `POST /advertising/campaigns`
- Body (`CreateCampaignInput`): `{ "advertiserId": string, "name": string, "budgetTotalCents": number, "startDate": ISO date, "endDate"?: ISO date, "destinationUrl"?: string, "promoCode"?: string, "createdBy"?: string }`
- Response `201`: the created `AdCampaign` (`status: DRAFT`).

#### `GET /advertising/campaigns`
- Query: `advertiserId?`
- Response `200`: matching `AdCampaign[]`.

#### `GET /advertising/campaigns/:id`
- Response `200`: one campaign, with `creatives`, `placements`, `targetRules` included. Errors: `404`.

#### `PATCH /advertising/campaigns/:id`
- Body: partial `{ name?, budgetTotalCents?, startDate?, endDate?, destinationUrl?, promoCode? }`
- Response `200`: the updated campaign. Errors: `400` if archived (archived campaigns reject all edits).

#### `POST /advertising/campaigns/:id/pause`
- Response `200`: the campaign with `status: PAUSED`.

#### `POST /advertising/campaigns/:id/activate`
Only `DRAFT` or `PAUSED` campaigns may be activated.
- Response `200`: the campaign with `status: ACTIVE`. Errors: `400` otherwise.

#### `POST /advertising/campaigns/:id/archive`
Terminal state.
- Response `200`: the campaign with `status: ARCHIVED`.

#### `POST /advertising/campaigns/:id/frequency-cap`
- Body: `{ "frequencyCapCount": number | null, "frequencyCapPeriod": string | null }` (e.g. `"DAILY"`, `"CAMPAIGN"`)
- Response `200`: the updated campaign.

#### `POST /advertising/campaigns/:id/spend`
Manual admin spend posting: atomically records the advertiser-side debit
and the platform-side revenue credit for one billing event (there is no
automatic CPM/CPC billing yet — see README known gaps).
- Body: `{ "amountCents": number, "description"?: string }`
- Response `201`: `{ "spend": LedgerEntry, "revenue": LedgerEntry }`.

### Creatives

#### `POST /advertising/campaigns/:id/creatives`
- Body (`CreativeInput`): `{ "type": AdCreativeType, "assetUrl": string, "headline"?: string, "bodyText"?: string, "ctaLabel"?: string }`
- Response `201`: the created `AdCreative`.

#### `POST /advertising/campaigns/:id/creatives/replace`
- Body: same as above.
- Response `201`: the new creative (replaces the previous one for the campaign).

#### `GET /advertising/campaigns/:id/creatives`
- Response `200`: `AdCreative[]` for the campaign.

### Placements

#### `PUT /advertising/campaigns/:id/placements/:placement`
`:placement` is an `AdPlacementSlot` value — a fixed, closed enum matching
only safety-neutral screens, specifically so ad content can never be
substituted onto navigation/emergency/trip-control/driver-ID surfaces.
- Body: `{ "priority"?: number }`
- Response `200`: the upserted `AdCampaignPlacement`.

#### `DELETE /advertising/campaigns/:id/placements/:placement`
- Response `204`.

#### `GET /advertising/campaigns/:id/placements`
- Response `200`: `AdCampaignPlacement[]`.

### Target rules

A campaign matches a viewer if **any** of its target rules match (OR
across rules).

#### `POST /advertising/campaigns/:id/target-rules`
- Body (`AddTargetRuleInput`): `{ "scope": "ENTIRE_MARKET"|"ZONE"|"ZIP"|"RADIUS", "marketId"?, "zoneId"?, "zip"?, "radiusCenterLat"?, "radiusCenterLng"?, "radiusMiles"? }` — required fields differ per `scope` (see validation in `campaign.service.ts`: `ENTIRE_MARKET` needs `marketId`; `ZONE` needs `marketId`+`zoneId`; `ZIP` needs `zip`; `RADIUS` needs all three radius fields).
- Response `201`: the created `AdTargetRule`.

#### `DELETE /advertising/campaigns/:id/target-rules/:ruleId`
- Response `204`. Errors: `400` if the rule doesn't belong to that campaign.

#### `GET /advertising/campaigns/:id/target-rules`
- Response `200`: `AdTargetRule[]`.

### Ad serving

#### `GET /advertising/serve`
The actual ad-serving call a client makes. Computes personalized-ad
consent **server-side** (never trusts a client-supplied flag) by calling
into [Ad consent](#ad-consent).
- Query (all required except market/zone/zip/lat/lng which are optional
  targeting context): `placement` (`AdPlacementSlot`), `viewerType`
  (`DRIVER`|`RIDER`), `viewerId`, `marketId?`, `zoneId?`, `zip?`,
  `viewerLat?`, `viewerLng?`
- Response `200`: `{ "placement": string, "campaigns": AdCampaign[] }` — the
  eligible campaign(s) for that placement/viewer, after consent + targeting
  + frequency-cap filtering.
- Errors: `400` if `placement`/`viewerType`/`viewerId` missing.

#### `POST /advertising/impressions`
- Body (`RecordImpressionInput`): `{ "campaignId": string, "creativeId": string, "placement": AdPlacementSlot, "viewerType": AdViewerType, "viewerId": string, "marketId"?, "zoneId"?, "zip"? }`
- Response `201`: the created `AdImpression` (`isUniqueForViewer` computed automatically).

#### `POST /advertising/impressions/:id/click`
- Response `201`: the created `AdClick`. Errors: `404` if the impression doesn't exist.

#### `POST /advertising/conversions`
- Body (`RecordConversionInput`): `{ "campaignId": string, "conversionType": string (e.g. PROMO_CODE_REDEEMED, SIGNUP, PURCHASE), "referenceId"?: string, "amountCents"?: number }`
- Response `201`: the created `AdConversion`.

#### `POST /advertising/promo-redemptions`
- Body (`RedeemPromoCodeInput`): `{ "campaignId": string, "promoCode": string, "userId": string, "userType": AdViewerType, "referenceId"?: string }`
- Response `201`: the created `PromoCodeRedemption`. Errors: `400` if the promo code doesn't match the campaign's.

### Analytics (aggregated only)

Advertisers never see a raw list of which riders/drivers were served — only
rollups.

#### `GET /advertising/campaigns/:id/analytics`
- Response `200`: `CampaignAnalytics` — impressions, unique impressions, clicks, CTR, conversions, promo redemptions, spend/remaining budget.

#### `GET /advertising/campaigns/:id/analytics/zones`
- Response `200`: `GeoPerformanceRow[]` broken down by zone.

#### `GET /advertising/campaigns/:id/analytics/zips`
- Response `200`: `GeoPerformanceRow[]` broken down by ZIP.

---

## Ad consent

Base path: `/ad-consent`. Kept **completely separate** from Terms of
Service acceptance — accepting the ToS is never treated as advertising
consent, and vice versa. Append-only: every preference change inserts a new
row; absence of a record means **not consented** (fail closed).

#### `POST /ad-consent/`
- Body (`RecordConsentInput`): `{ "driverId"?: string, "riderId"?: string (exactly one required), "consentType": AdConsentType, "status": "GRANTED"|"DENIED"|"WITHDRAWN", "policyVersion": string, "sourceScreen"?: string }`
- Response `201`: the created `AdConsentRecord`.

#### `GET /ad-consent/current`
- Query: `driverId?`, `riderId?` (exactly one required), `consentType` — there is **no default** here (unlike the therapy-rides equivalent below); omitting it means "any consent type," which is almost certainly not what you want, so always pass it explicitly (e.g. `consentType=PERSONALIZED_OFFERS`).
- Response `200`: `{ "current": AdConsentRecord | null }` — `null` must be treated as not-consented.

#### `GET /ad-consent/personalized-status`
Convenience check used by Advertising (and back-office tooling).
- Query: `driverId?`, `riderId?`
- Response `200`: `{ "hasPersonalizedConsent": boolean }` — `true` only if
  the current `PERSONALIZED_OFFERS` record is `GRANTED` and not since
  withdrawn.

#### `POST /ad-consent/tos-acceptance`
Separate model entirely — see the module-level warning above.
- Body (`RecordTosAcceptanceInput`): `{ "userId": string, "userType": AdViewerType, "policyVersion": string }`
- Response `201`: the created `TermsOfServiceAcceptance`.

---

## Therapy rides

Base path: `/therapy-rides`. Licensed-therapist ride-along sessions: its own
consent model, therapist-vetted route safety, and multi-payer fee
splitting. See README's dedicated section for the full design rationale;
this is an MVP scaffold (known gaps listed there), not a
compliance-complete clinical product.

#### `POST /therapy-rides/consent`
- Body (`RecordTherapyConsentInput`): `{ "patientId": string, "consentType": TherapyConsentType, "status": "GRANTED"|"DENIED"|"WITHDRAWN", "policyVersion": string }`
- Response `201`: the created `TherapyConsentRecord`.

#### `GET /therapy-rides/consent/current`
- Query: `patientId`, `consentType?` (default `TREATMENT_CONSENT`)
- Response `200`: `{ "current": TherapyConsentRecord | null }`.

#### `POST /therapy-rides/therapists`
- Body: `{ "name": string, "email": string, "licenseNumber": string, "licenseState": string, "npiNumber"?: string }`
- Response `201`: the created `Therapist`.

#### `GET /therapy-rides/therapists/:id`
- Response `200`: one `Therapist`. Errors: `404`.

#### `POST /therapy-rides/therapists/:id/safe-routes`
- Body (`CreateSafeRouteInput`): `{ "name": string, "zoneId"?: string, "estimatedDurationMinutes": number }`
- Response `201`: the created `TherapistSafeRoute`.

#### `GET /therapy-rides/therapists/:id/safe-routes`
- Response `200`: `TherapistSafeRoute[]` for that therapist.

#### `POST /therapy-rides/safe-routes/:id/deactivate`
- Response `200`: the route with `active: false`.

#### `POST /therapy-rides/sessions`
Requests a session and immediately offers up to 3 routes drawn only from
the assigned therapist's own active safe routes (closest match to
`durationMinutes`).
- Body (`RequestSessionInput`): `{ "patientId": string, "therapistId": string, "marketId": string, "serviceTypeId": string, "scheduledStart": ISO date, "durationMinutes": number, "feeCents": number, "payerType": "SELF_PAY"|"INSURANCE"|"EMPLOYER_SPONSORED", "sponsorId"?: string (required if EMPLOYER_SPONSORED), "insurance"?: { "payerName": string, "memberIdLast4": string, "patientResponsibilityCents": number } (required if INSURANCE) }`
- Response `201`: the created `TherapySession`, with `routeOffers` (each
  wrapping a `TherapistSafeRoute`) and `insuranceClaim` (if applicable)
  included.
- Errors: `400` if the patient lacks an active (`GRANTED`, non-withdrawn)
  `TREATMENT_CONSENT` record, or if the therapist has zero active safe
  routes configured. `404` if the therapist doesn't exist.

#### `GET /therapy-rides/sessions/:id`
- Response `200`: the `TherapySession` with `routeOffers`/`insuranceClaim` included. Errors: `404`.

#### `POST /therapy-rides/sessions/:id/select-route`
Patient selects one of the offered routes — **this is the only point a
real `Ride` is created** (nothing is dispatched before this).
- Body: `{ "routeOfferId": string }`
- Response `200`: the updated `TherapySession` (`status: ROUTE_SELECTED`, `rideId` set).
- Errors: `400` if the session isn't awaiting a route selection, or the offer doesn't belong to this session.

#### `POST /therapy-rides/sessions/:id/cancel`
- Response `200`: the updated session (`status: CANCELLED`).
- Errors: `400` if already `COMPLETED`/`CANCELLED`.

#### `POST /therapy-rides/insurance-claims/:id/mark-paid`
Manual settlement of the insurer's share (there's no real clearinghouse
integration — see README known gaps). The patient's own responsibility
portion is already posted to the ledger at ride completion; this posts the
insurer's remaining share once it has actually been received.
- Response `204`.

---

## Ledger / driver earnings

No HTTP endpoints — `src/lib/ledger.ts` is the **only** code path allowed
to write `LedgerEntry`, `DriverEarningsLine`, and `RiderReceiptLine` rows.
Every other module posts money by calling `postLedgerEntry`/
`postDriverEarningsLine`/`postRiderReceiptLine` from inside its own
transaction — never by writing a bespoke "amount" field on a
module-specific table. Ledger rows are never updated or deleted by
application code; a correction is always a new, offsetting entry.

Read driver/rider-facing views via `GET /rides/:id`'s `earningsLines`
(driver) and `receiptLines` (rider) fields, or by querying `LedgerEntry`
directly for a full cross-module accounting trace (`rideId`, `orderId`,
`driverSaleId`, `evBonusLineItemId`, `sponsorshipContributionId`,
`adCampaignId`, `paymentId`, `refundId`, `therapySessionId`,
`insuranceClaimId` all tag back to their originating row).

---

## Health check

#### `GET /health`
- Response `200`: `{ "status": "ok" }`. No auth, no dependencies checked (not a readiness probe against the database).
