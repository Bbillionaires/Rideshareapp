import express, { NextFunction, Request, Response } from "express";
import "./bootstrap";
import { HttpError } from "./lib/http";
import { evIncentivesRouter } from "./modules/ev-incentives/routes";
import { sponsorshipsRouter } from "./modules/sponsorships/routes";
import { ridesRouter } from "./modules/rides/routes";
import { commerceRouter } from "./modules/commerce/routes";
import { driverInventoryRouter } from "./modules/driver-inventory/routes";
import { advertisingRouter } from "./modules/advertising/routes";
import { adConsentRouter } from "./modules/ad-consent/routes";
import { therapyRidesRouter } from "./modules/therapy-rides/routes";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/rides", ridesRouter);
  app.use("/ev-incentives", evIncentivesRouter);
  app.use("/sponsorships", sponsorshipsRouter);
  app.use("/commerce", commerceRouter);
  app.use("/driver-inventory", driverInventoryRouter);
  app.use("/advertising", advertisingRouter);
  app.use("/ad-consent", adConsentRouter);
  app.use("/therapy-rides", therapyRidesRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  createApp().listen(port, () => {
    console.log(`rideshareapp listening on :${port}`);
  });
}
