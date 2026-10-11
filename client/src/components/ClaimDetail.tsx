import { useState } from "react";
import { api } from "../api";
import { categoryLabel, formatMoney } from "../format";
import { useAsync } from "../hooks";
import { Link } from "../router";
import type { AppConfig, ClaimDetail as Detail } from "../types";
import { AiFinding } from "./AiFinding";
import { DecisionPanel } from "./DecisionPanel";
import { HistoryTimeline } from "./HistoryTimeline";
import { Card, Empty, ErrorBox, Loading, SeverityBadge, StatusBadge } from "./ui";

// One claim, everything a reviewer needs: the data, the deterministic flags,
// the AI's advice, the decision buttons and the full history.

export function ClaimDetail({ id, config }: { id: number; config: AppConfig }) {
  const detail = useAsync(() => api.getClaim(id), [id]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string>();

  async function runReview() {
    setReviewing(true);
    setReviewError(undefined);
    try {
      await api.runReview(id);
      detail.reload();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "AI review failed");
    } finally {
      setReviewing(false);
    }
  }

  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading label="Loading claim…" />;

  const claim = detail.data;
  const isFinal = claim.status === "approved" || claim.status === "rejected";

  return (
    <div className="detail">
      <Link to="/claims" className="back">
        ← All claims
      </Link>

      <Card title={`Claim #${claim.id}`} actions={<StatusBadge status={claim.status} />}>
        <ClaimFacts claim={claim} config={config} />
      </Card>

      <Card title="Validation checks">
        <ValidationFlags claim={claim} />
      </Card>

      <Card
        title="AI review"
        actions={
          <button type="button" className="btn" onClick={runReview} disabled={reviewing || isFinal}>
            {reviewing ? "Reviewing…" : claim.aiReviews.length ? "Run again" : "Run AI review"}
          </button>
        }
      >
        {reviewError && <ErrorBox error={new Error(reviewError)} />}
        <AiFinding review={claim.aiReviews[0]} config={config} runCount={claim.aiReviews.length} />
      </Card>

      <Card title="Decision">
        <DecisionPanel claim={claim} config={config} onDone={detail.reload} />
      </Card>

      <Card title="History">
        <HistoryTimeline events={claim.auditEvents} config={config} aiReviews={claim.aiReviews} />
      </Card>
    </div>
  );
}

function ClaimFacts({ claim, config }: { claim: Detail; config: AppConfig }) {
  return (
    <dl className="facts">
      <div>
        <dt>Claimant</dt>
        <dd>{claim.claimant}</dd>
      </div>
      <div>
        <dt>Date</dt>
        <dd>{claim.date}</dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>{formatMoney(claim.amount, claim.currency)}</dd>
      </div>
      <div>
        <dt>Category</dt>
        <dd>
          {categoryLabel(config, claim.finalCategory ?? claim.category)}
          {claim.finalCategory && (
            <div className="small muted">Overridden; claimed as {categoryLabel(config, claim.category)}</div>
          )}
        </dd>
      </div>
      <div>
        <dt>Receipt</dt>
        <dd>{claim.receiptAvailable ? "Available" : "Not available"}</dd>
      </div>
      <div className="wide">
        <dt>Description</dt>
        <dd>{claim.description}</dd>
      </div>
    </dl>
  );
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function ValidationFlags({ claim }: { claim: Detail }) {
  if (claim.validationResults.length === 0) return <Empty>All checks passed.</Empty>;
  const sorted = [...claim.validationResults].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <ul className="flags">
      {sorted.map((r) => (
        <li key={r.id} className={`flag flag-${r.severity}`}>
          <SeverityBadge severity={r.severity} /> {r.message}
          <PolicyRefs details={r.details} />
        </li>
      ))}
    </ul>
  );
}

// Validators put policy references in details as policySection(s).
function PolicyRefs({ details }: { details?: Record<string, unknown> }) {
  const refs = [details?.policySection, ...((details?.policySections as unknown[]) ?? [])].filter(Boolean);
  if (refs.length === 0) return null;
  return <span className="muted small"> (policy §{refs.join(", §")})</span>;
}
