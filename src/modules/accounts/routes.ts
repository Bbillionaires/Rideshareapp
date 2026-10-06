import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import * as AccountsService from "./service";

export const accountsRouter = Router();

// ---- Drivers ----

accountsRouter.post(
  "/drivers",
  asyncHandler(async (req, res) => {
    const driver = await AccountsService.createDriver(req.body);
    res.status(201).json(driver);
  })
);

accountsRouter.get(
  "/drivers/:id",
  asyncHandler(async (req, res) => {
    res.json(await AccountsService.getDriver(req.params.id));
  })
);

accountsRouter.get(
  "/drivers/:id/vehicles",
  asyncHandler(async (req, res) => {
    res.json(await AccountsService.listVehiclesForDriver(req.params.id));
  })
);

accountsRouter.post(
  "/drivers/:id/online",
  asyncHandler(async (req, res) => {
    const session = await AccountsService.goOnline(req.params.id, req.body);
    res.status(201).json(session);
  })
);

accountsRouter.post(
  "/drivers/:id/offline",
  asyncHandler(async (req, res) => {
    res.json(await AccountsService.goOffline(req.params.id));
  })
);

accountsRouter.get(
  "/drivers/:id/status",
  asyncHandler(async (req, res) => {
    res.json(await AccountsService.getDriverStatus(req.params.id));
  })
);

// ---- Riders ----

accountsRouter.post(
  "/riders",
  asyncHandler(async (req, res) => {
    const rider = await AccountsService.createRider(req.body);
    res.status(201).json(rider);
  })
);

accountsRouter.get(
  "/riders/:id",
  asyncHandler(async (req, res) => {
    res.json(await AccountsService.getRider(req.params.id));
  })
);

// ---- Vehicles ----

accountsRouter.post(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const vehicle = await AccountsService.createVehicle(req.body);
    res.status(201).json(vehicle);
  })
);

// ---- Reference data ----

accountsRouter.get(
  "/markets",
  asyncHandler(async (_req, res) => {
    res.json(await AccountsService.listMarkets());
  })
);

accountsRouter.get(
  "/service-types",
  asyncHandler(async (_req, res) => {
    res.json(await AccountsService.listServiceTypes());
  })
);
