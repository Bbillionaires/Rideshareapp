import { Router } from "express";
import { OrderStatus, ProductStatus } from "@prisma/client";
import { asyncHandler } from "../../lib/http";
import * as CatalogService from "./catalog.service";
import * as OrdersService from "./orders.service";
import * as DriverSaleService from "./driver-sale.service";

export const commerceRouter = Router();

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return new Date(value);
}

// ----------------------------------------------------------------------------
// ProductCategory
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const category = await CatalogService.createProductCategory(req.body);
    res.status(201).json(category);
  })
);

commerceRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    res.json(await CatalogService.listProductCategories());
  })
);

commerceRouter.patch(
  "/categories/:id",
  asyncHandler(async (req, res) => {
    res.json(await CatalogService.updateProductCategory(req.params.id, req.body));
  })
);

// ----------------------------------------------------------------------------
// Product
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/products",
  asyncHandler(async (req, res) => {
    const product = await CatalogService.createProduct(req.body);
    res.status(201).json(product);
  })
);

commerceRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const { status, categoryId, resaleEligible } = req.query;
    res.json(
      await CatalogService.listProducts({
        status: status as ProductStatus | undefined,
        categoryId: categoryId as string | undefined,
        resaleEligible:
          resaleEligible === undefined ? undefined : resaleEligible === "true",
      })
    );
  })
);

commerceRouter.get(
  "/products/:id",
  asyncHandler(async (req, res) => {
    res.json(await CatalogService.getProduct(req.params.id));
  })
);

commerceRouter.patch(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (body.expiresAt) body.expiresAt = new Date(body.expiresAt);
    res.json(await CatalogService.updateProduct(req.params.id, body));
  })
);

commerceRouter.post(
  "/products/:id/images",
  asyncHandler(async (req, res) => {
    const image = await CatalogService.addProductImage(req.params.id, req.body);
    res.status(201).json(image);
  })
);

commerceRouter.delete(
  "/products/:id/images/:imageId",
  asyncHandler(async (req, res) => {
    res.json(await CatalogService.removeProductImage(req.params.imageId));
  })
);

// ----------------------------------------------------------------------------
// Discount
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/discounts",
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    body.startsAt = new Date(body.startsAt);
    if (body.endsAt) body.endsAt = new Date(body.endsAt);
    const discount = await CatalogService.createDiscount(body);
    res.status(201).json(discount);
  })
);

commerceRouter.get(
  "/discounts",
  asyncHandler(async (req, res) => {
    const { productId, categoryId, active } = req.query;
    res.json(
      await CatalogService.listDiscounts({
        productId: productId as string | undefined,
        categoryId: categoryId as string | undefined,
        active: active === undefined ? undefined : active === "true",
      })
    );
  })
);

// ----------------------------------------------------------------------------
// CommissionRule (driver-to-rider resale commission)
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/commission-rules",
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (body.effectiveStart) body.effectiveStart = new Date(body.effectiveStart);
    if (body.effectiveEnd) body.effectiveEnd = new Date(body.effectiveEnd);
    const rule = await CatalogService.createCommissionRule(body);
    res.status(201).json(rule);
  })
);

commerceRouter.get(
  "/commission-rules",
  asyncHandler(async (req, res) => {
    const { productId, categoryId, active } = req.query;
    res.json(
      await CatalogService.listCommissionRules({
        productId: productId as string | undefined,
        categoryId: categoryId as string | undefined,
        active: active === undefined ? undefined : active === "true",
      })
    );
  })
);

commerceRouter.patch(
  "/commission-rules/:id",
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (body.effectiveStart) body.effectiveStart = new Date(body.effectiveStart);
    if (body.effectiveEnd) body.effectiveEnd = new Date(body.effectiveEnd);
    res.json(await CatalogService.updateCommissionRule(req.params.id, body));
  })
);

commerceRouter.post(
  "/commission-rules/:id/deactivate",
  asyncHandler(async (req, res) => {
    res.json(await CatalogService.deactivateCommissionRule(req.params.id));
  })
);

// ----------------------------------------------------------------------------
// Bundle
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/bundles",
  asyncHandler(async (req, res) => {
    const bundle = await CatalogService.createBundle(req.body);
    res.status(201).json(bundle);
  })
);

commerceRouter.get(
  "/bundles",
  asyncHandler(async (_req, res) => {
    res.json(await CatalogService.listBundles());
  })
);

// ----------------------------------------------------------------------------
// InventoryLocation / InventoryStock
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/inventory-locations",
  asyncHandler(async (req, res) => {
    const location = await CatalogService.createInventoryLocation(req.body.name);
    res.status(201).json(location);
  })
);

commerceRouter.get(
  "/inventory-locations",
  asyncHandler(async (_req, res) => {
    res.json(await CatalogService.listInventoryLocations());
  })
);

commerceRouter.post(
  "/inventory-stock/:productId/:locationId",
  asyncHandler(async (req, res) => {
    const stock = await CatalogService.adjustInventoryStock(
      req.params.productId,
      req.params.locationId,
      req.body
    );
    res.json(stock);
  })
);

commerceRouter.get(
  "/inventory-stock/:productId",
  asyncHandler(async (req, res) => {
    res.json(await CatalogService.getInventoryStock(req.params.productId));
  })
);

// ----------------------------------------------------------------------------
// Orders (driver buying from the store)
// ----------------------------------------------------------------------------

commerceRouter.post(
  "/orders",
  asyncHandler(async (req, res) => {
    const order = await OrdersService.placeOrder(req.body);
    res.status(201).json(order);
  })
);

commerceRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const { buyerDriverId, status, startDate, endDate } = req.query;
    res.json(
      await OrdersService.viewOrders({
        buyerDriverId: buyerDriverId as string | undefined,
        status: status as OrderStatus | undefined,
        startDate: parseDate(startDate),
        endDate: parseDate(endDate),
      })
    );
  })
);

commerceRouter.post(
  "/orders/:id/refund",
  asyncHandler(async (req, res) => {
    const { amountCents, reason, issuedBy } = req.body;
    res.json(await OrdersService.issueRefund(req.params.id, amountCents, reason, issuedBy));
  })
);

commerceRouter.post(
  "/orders/:id/fulfillments",
  asyncHandler(async (req, res) => {
    const fulfillment = await OrdersService.createFulfillment(req.params.id, req.body);
    res.status(201).json(fulfillment);
  })
);

commerceRouter.patch(
  "/fulfillments/:id",
  asyncHandler(async (req, res) => {
    const { status, carrier, trackingNumber } = req.body;
    res.json(
      await OrdersService.updateFulfillmentStatus(req.params.id, status, { carrier, trackingNumber })
    );
  })
);

// ----------------------------------------------------------------------------
// Sales analytics
// ----------------------------------------------------------------------------

commerceRouter.get(
  "/analytics/sales",
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    res.json(
      await OrdersService.viewSalesAnalytics({
        startDate: parseDate(startDate),
        endDate: parseDate(endDate),
      })
    );
  })
);

// ----------------------------------------------------------------------------
// Driver-to-rider resale
// ----------------------------------------------------------------------------

commerceRouter.get(
  "/driver-sales/available/:driverId",
  asyncHandler(async (req, res) => {
    res.json(await DriverSaleService.getAvailableProductsForDriver(req.params.driverId));
  })
);

commerceRouter.post(
  "/driver-sales",
  asyncHandler(async (req, res) => {
    const sale = await DriverSaleService.createDriverSale(req.body);
    res.status(201).json(sale);
  })
);

commerceRouter.post(
  "/driver-sales/:id/refund",
  asyncHandler(async (req, res) => {
    const { reason, issuedBy } = req.body;
    res.json(await DriverSaleService.refundDriverSale(req.params.id, reason, issuedBy));
  })
);
