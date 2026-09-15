# RideshareApp backend

Node.js + TypeScript + Prisma (PostgreSQL) backend implementing the EV driver
compensation engine, the in-app driver store, driver-to-rider commerce, the
business advertising platform, and the driver-sponsorship program, on top of
a minimal rides/dispatch/pricing foundation.

## Architecture

The system is organized into bounded modules under `src/modules/`. Modules
only ever reference each other by id — never by embedding another module's
money fields directly — and every dollar that moves is recorded exactly once
in the append-only `LedgerEntry` table (see `src/lib/ledger.ts`), tagged with
its originating module (`sourceModule`) and a specific `entryType`. This is
what makes it possible to answer "where did every dollar originate, and
where did it go" without ever mixing ride revenue, merchandise revenue, and
advertising revenue into one generic amount field.

| Module | Responsibility |
| --- | --- |
| `rides` | Trip lifecycle (request → accept → start → complete/cancel) |
| `dispatch` | Offer/response log (`RideOffer`) — intentionally minimal |
| `pricing` | Computes the standard ride fare and "standard driver earnings" |
| `ev-incentives` | Admin-configurable EV compensation rule engine + EV vs non-EV analytics |
| `sponsorships` | Business-sponsored driver incentive programs |
| `commerce` | In-app driver store (catalog, orders) + driver-to-rider resale |
| `driver-inventory` | Per-driver on-hand stock for resale |
| `payments` | Generic payment/refund processing |
| `advertising` | Ad campaigns, creatives, geographic targeting, analytics |
| `ad-consent` | Advertising consent records (kept distinct from ToS acceptance) |
| `driver-earnings` | The ledger itself, plus driver/rider-facing summary views (`src/lib/ledger.ts`, `DriverEarningsLine`, `RiderReceiptLine`) |

Cross-module orchestration at ride completion (pricing → EV incentives →
sponsorships) happens through a hook registry
(`src/modules/rides/hooks.ts`) rather than direct imports, so `rides` never
needs to know `ev-incentives` or `sponsorships` exist. Wiring happens once in
`src/bootstrap.ts`.

## EV driver compensation

Nothing is hard-coded. Admins configure `EvCompensationRule` rows supporting:

- flat bonus per trip, percentage of standard earnings, per-mile supplement,
  and an optional minimum floor — all composable on the same rule;
- scoping by market and/or service type (`null` = applies everywhere);
- promotional rules that stack additively on top of the one best-matching
  base rule;
- effective start/end dates;
- a funding source of `PLATFORM`, `RIDER`, `SPONSOR`, or `SPLIT` (with a
  `splitConfig` JSON like `{"platform":0.5,"sponsor":0.5}`).

EV eligibility is derived only from the ride's `Vehicle` record
(`fuelType === 'EV' && approvalStatus === 'APPROVED' && active`) — a driver
can never self-declare EV status (see `ev-incentives/eligibility.ts`).

Every applied rule produces an `EvBonusLineItem`, which is what "clearly
identifies the EV component" on both the driver earnings ledger
(`DriverEarningsLine`, `lineType: EV_SUPPLEMENT`) and the rider receipt
(`RiderReceiptLine`, `lineType: EV_SUPPLEMENT_CHARGE`, only posted when the
rider actually funds part of it).

## Driver store & driver-to-rider commerce

- Admins manage the full commerce catalog (`ProductCategory`, `Product`,
  `ProductImage`, `Discount`, `Bundle`, `InventoryStock`) and driver store
  orders (`Order`/`OrderItem`/`Fulfillment`) under `commerce/`.
- Drivers can only resell a product that is explicitly `resaleEligible` on
  its platform `Product` record — never an arbitrary upload. `DriverSale`
  captures every field the spec requires (product, SKU, driver, rider, ride,
  quantity, sale price, platform cost, driver commission, platform profit,
  timestamp), and unconditionally refuses sale of a product that is not
  `ACTIVE`, not `resaleEligible`, expired, age-restricted, or in a
  `regulatedCategory` (the MVP has no path to enable alcohol, tobacco/
  nicotine, cannabis, prescription drugs, weapons, or similar).
- `driver-inventory` tracks each driver's on-hand stock and is decremented
  automatically inside the same transaction as the sale.
- The rider is charged directly (`payments` module) — the driver never
  handles the rider's card payment.

## Advertising & consent

- `AdPlacementSlot` is a fixed, closed enum matching only the safety-neutral
  screens named in the spec, specifically so ad content can never be
  substituted onto navigation, emergency, trip-control, or driver-ID
  surfaces.
- Geographic targeting (`AdTargetRule`) matches on entire market, zone, ZIP,
  or a lat/lng radius, against the existing `Market`/`Zone`/`ZipZoneMapping`
  data (seeded for Jacksonville — see below).
- `AdConsentRecord` is completely separate from `TermsOfServiceAcceptance`;
  accepting the ToS is never treated as advertising consent. Consent is
  append-only (a new record always superseds the last), and its absence is
  treated as "not consented." Zone/ZIP/radius-targeted ads additionally
  require personalized-ad consent; market-wide targeting does not.
- Analytics are aggregated only (impressions, unique impressions, clicks,
  CTR, conversions, promo redemptions, spend/remaining budget, zone/ZIP
  performance) — advertisers never see a raw list of which riders/drivers
  were served.

## Getting started

```bash
cp .env.example .env   # point DATABASE_URL at a local Postgres
npm install
npx prisma migrate dev # creates tables + generates the Prisma client
npx prisma db seed     # seeds the Jacksonville market/zones/service types
npm run build && npm start
# or: npm run dev
```

`npm run typecheck` runs `tsc --noEmit` across the whole project.

## Testing

The test suite is integration-first: the financial logic lives almost
entirely in Prisma queries and transactions, so mocking the database would
mostly test the mocks. Tests run against a real, dedicated Postgres database
(`rideshareapp_test` by default — never the dev database), truncated and
reseeded between every test (`tests/helpers/db.ts`).

```bash
createdb rideshareapp_test   # once, or: psql -c "CREATE DATABASE rideshareapp_test;"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rideshareapp_test?schema=public" \
  npx prisma migrate deploy
npm test
```

Set `TEST_DATABASE_URL` (see `tests/env.ts`) to point at a different test
database. Coverage focuses on the money-moving paths and their edge cases:
EV bonus rule matching/stacking/funding-source reconciliation, the
driver-to-rider resale flow's eligibility gates and commission/profit split,
cumulative refund limits, discount validation, and consent-gated ad
targeting — including regression tests for every bug found in code review
(sponsorship contribution mismatch, cumulative over-refund, unlogged
platform losses, unclamped discounts).

## Notes / known gaps

- `dispatch` and the fare formula in `pricing` are intentionally minimal —
  they exist to give the other modules something real to hook into, not as
  a finished pricing/dispatch system.
- There's no tax-rate configuration model yet, so `Order.taxCents` is
  always `0` in the driver-store purchase flow.
- Radius-based ad targeting needs the viewer's lat/lng; ad-serving calls
  that don't supply it simply skip `RADIUS` rules rather than erroring.
- `recordCampaignSpend`/`recordAdRevenue` exist and are ledger-correct but
  are only wired to a manual admin "record spend" endpoint — the spec left
  the actual billing model (CPM/CPC/flat) undefined.
