import { Router } from "express";
import { z } from "zod";
import { auditedChange } from "../audit/audit";
import { reviewerOnly } from "../auth/middleware";
import {
  DECISION_ACTIONS,
  FINAL_STATUSES,
  getClaim,
  insertDecision,
  insertValidationResults,
  listValidationResults,
  updateClaimStatus,
  updateFinalCategory,
  type ClaimStatus,
  type DecisionAction,
} from "../db/repository";
import { HttpError, parseInput } from "../errors";
import { checkCategoryLimit } from "../validators";
import { parseClaimId, requireClaim, type AppDeps } from "./shared";

const REASON_REQUIRED: DecisionAction[] = ["reject", "request_clarification", "override_category"];

const STATUS_AFTER: Partial<Record<DecisionAction, ClaimStatus>> = {
  approve: "approved",
  reject: "rejected",
  request_clarification: "clarification_requested",
};

function decisionSchema(categoryKeys: string[]) {
  return z
    .object({
      action: z.enum(DECISION_ACTIONS),
      reason: z.string().trim().max(1000).optional(),
      overrideCategory: z.string().trim().optional(),
    })
    .superRefine((d, ctx) => {
      if (REASON_REQUIRED.includes(d.action) && !d.reason) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: `A reason is required to ${d.action.replace("_", " ")}` });
      }
      if (d.action === "override_category") {
        if (!d.overrideCategory || !categoryKeys.includes(d.overrideCategory)) {
          ctx.addIssue({
            code: "custom",
            path: ["overrideCategory"],
            message: `overrideCategory must be one of: ${categoryKeys.join(", ")}`,
          });
        }
      } else if (d.overrideCategory !== undefined) {
        ctx.addIssue({ code: "custom", path: ["overrideCategory"], message: "Only allowed for override_category" });
      }
    });
}

export function decisionsRouter({ store, config, auth }: AppDeps): Router {
  const router = Router();
  const { db } = store;
  const schema = decisionSchema(Object.keys(config.categories));

  // The reviewer is the logged-in user. A "reviewer" field in the body is
  // ignored (zod drops unknown keys), so nobody can decide in someone else's name.
  router.post("/:id/decision", ...reviewerOnly(auth.jwtSecret), async (req, res) => {
    const id = parseClaimId(req.params.id);
    const input = parseInput(schema, req.body);
    const reason = input.reason || null;
    const reviewer = req.user!.username; // set by requireAuth

    const { decisionId } = await auditedChange(
      store,
      async (session) => {
        // Checked inside the transaction. Every decision also writes to the
        // claim document, so if two reviewers decide at once their
        // transactions conflict, MongoDB retries one, and the retry sees the
        // claim is already final and is refused below.
        const claim = await requireClaim(store, id, session);
        if (FINAL_STATUSES.includes(claim.status)) {
          throw new HttpError(409, `Claim ${id} is already ${claim.status}; no further decisions are allowed`);
        }
        // Approving over a hard validation error (e.g. an exact duplicate) is
        // allowed, since the human decides, but they must say why.
        if (input.action === "approve" && !reason) {
          const errors = (await listValidationResults(db, id, session)).filter((r) => r.severity === "error");
          if (errors.length > 0) {
            throw new HttpError(400, "A reason is required to approve a claim with validation errors", {
              validationErrors: errors.map((e) => e.message),
            });
          }
        }
        if (input.action === "override_category" && input.overrideCategory === (claim.finalCategory ?? claim.category)) {
          throw new HttpError(400, `Claim ${id} is already in category ${input.overrideCategory}`);
        }

        const newDecisionId = await insertDecision(
          db,
          { claimNumber: id, reviewer, action: input.action, reason, overrideCategory: input.overrideCategory ?? null },
          session,
        );

        const nextStatus = STATUS_AFTER[input.action];
        if (nextStatus) await updateClaimStatus(db, id, nextStatus, session);
        if (input.action === "override_category") {
          // The AI's output is left untouched; only the claim's final category changes.
          await updateFinalCategory(db, id, input.overrideCategory!, session);
          // Limits differ per category, so re-check against the new one.
          const limitCheck = checkCategoryLimit({ ...claim, category: input.overrideCategory! }, config);
          const prefix = `After override to ${config.categories[input.overrideCategory!]!.label}`;
          await insertValidationResults(
            db,
            id,
            limitCheck.length > 0
              ? limitCheck.map((r) => ({ ...r, message: `${prefix}: ${r.message}` }))
              : [{ checkName: "category_limit", severity: "info", message: `${prefix}: within the per-claim limit` }],
            session,
          );
        }
        return { decisionId: newDecisionId, before: claim, after: (await getClaim(db, id, session))! };
      },
      ({ decisionId: newDecisionId, before, after }) => ({
        claimNumber: id,
        actor: reviewer,
        action: input.action === "override_category" ? "category_overridden" : `decision_${input.action}`,
        before: { status: before.status, finalCategory: before.finalCategory, category: before.category },
        after: { status: after.status, finalCategory: after.finalCategory, decisionId: newDecisionId },
        reason,
      }),
    );

    req.log.info({ claimId: id, decisionId, action: input.action }, "Decision recorded");
    res.status(201).json({ decisionId, claim: await getClaim(db, id) });
  });

  return router;
}
