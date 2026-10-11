import { Router } from "express";
import { reviewerOnly } from "../auth/middleware";
import { listClaimsForTotals } from "../db/repository";
import { calculateTotals } from "../validators";
import type { AppDeps } from "./shared";

// Read-only endpoints that are not about a single claim. /health and /config
// are public; /totals is for reviewers.
export function metaRouter({ store, config, aiClient, auth }: AppDeps): Router {
  const router = Router();

  // Reviewer area. Rejected claims are excluded; category overrides are applied.
  router.get("/totals", ...reviewerOnly(auth.jwtSecret), async (_req, res) => {
    res.json({ ...calculateTotals(await listClaimsForTotals(store.db), config), excludes: ["rejected"] });
  });

  // PUBLIC, because the public claim form needs it. The parts of config the UI
  // needs (form options, limits), so the client never keeps its own copy that
  // could drift from config.json. Nothing secret here.
  router.get("/config", (_req, res) => {
    res.json({
      baseCurrency: config.baseCurrency,
      currencies: Object.keys(config.exchangeRates),
      receiptRequiredAbove: config.receiptRequiredAbove,
      categories: Object.entries(config.categories).map(([key, c]) => ({ key, label: c.label, perClaimLimit: c.perClaimLimit })),
    });
  });

  router.get("/health", async (_req, res) => {
    await store.db.command({ ping: 1 }); // throws (-> 500) if the database is unreachable
    res.json({ status: "ok", db: "ok", ai: { mode: aiClient.isMock ? "mock" : "anthropic", model: aiClient.model } });
  });

  return router;
}
