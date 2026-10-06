import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import * as DriverInventoryService from "./service";

export const driverInventoryRouter = Router();

driverInventoryRouter.post(
  "/restock",
  asyncHandler(async (req, res) => {
    const { driverId, productId, quantity } = req.body;
    const item = await DriverInventoryService.restockDriverInventory(
      driverId,
      productId,
      quantity
    );
    res.status(201).json(item);
  })
);

driverInventoryRouter.post(
  "/availability",
  asyncHandler(async (req, res) => {
    const { driverId, productId, isAvailableForSale } = req.body;
    const item = await DriverInventoryService.setAvailability(
      driverId,
      productId,
      isAvailableForSale
    );
    res.json(item);
  })
);

driverInventoryRouter.get(
  "/:driverId",
  asyncHandler(async (req, res) => {
    const items = await DriverInventoryService.getMyInventory(req.params.driverId);
    res.json(items);
  })
);
