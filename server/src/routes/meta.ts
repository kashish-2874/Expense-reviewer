import { Router } from "express";
import { listClaimsForTotals } from "../db/repository";
import { calculateTotals } from "../validators";
import type { AppDeps } from "./shared";

// Read-only endpoints that are not about a single claim.
export function metaRouter({ db, config, aiClient }: AppDeps): Router {
  const router = Router();

  // Rejected claims are excluded; reviewer category overrides are applied.
  router.get("/totals", (_req, res) => {
    res.json({ ...calculateTotals(listClaimsForTotals(db), config), excludes: ["rejected"] });
  });

  // The parts of config the UI needs (form options, limits), so the client never
  // keeps its own copy that could drift from config.json.
  router.get("/config", (_req, res) => {
    res.json({
      baseCurrency: config.baseCurrency,
      currencies: Object.keys(config.exchangeRates),
      receiptRequiredAbove: config.receiptRequiredAbove,
      categories: Object.entries(config.categories).map(([key, c]) => ({ key, label: c.label, perClaimLimit: c.perClaimLimit })),
    });
  });

  router.get("/health", (_req, res) => {
    db.prepare("SELECT 1").get(); // throws (-> 500) if the DB is unusable
    res.json({ status: "ok", db: "ok", ai: { mode: aiClient.isMock ? "mock" : "anthropic", model: aiClient.model } });
  });

  return router;
}
