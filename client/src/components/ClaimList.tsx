import { useState } from "react";
import { api } from "../api";
import { categoryLabel, formatMoney, STATUS_LABELS } from "../format";
import { navigate, useAsync } from "../hooks";
import type { AppConfig, ClaimStatus, ClaimSummary } from "../types";
import { Card, Empty, ErrorBox, Loading, StatusBadge, UncertainBadge } from "./ui";

// The reviewer's queue: every claim with its status, AI flags and validation
// counts, filterable by status. Clicking a row opens the claim.

export function ClaimList({ config }: { config: AppConfig }) {
  const [status, setStatus] = useState<ClaimStatus | "">("");
  const claims = useAsync(() => api.listClaims(status || undefined), [status]);

  const filter = (
    <div className="row">
      <label className="inline-label">
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | "")}>
          <option value="">All</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-small" onClick={claims.reload}>
        Refresh
      </button>
    </div>
  );

  return (
    <Card title="Claims" actions={filter}>
      {claims.error ? (
        <ErrorBox error={claims.error} onRetry={claims.reload} />
      ) : !claims.data ? (
        <Loading />
      ) : claims.data.length === 0 ? (
        <Empty>
          {status ? `No claims with status "${STATUS_LABELS[status]}".` : "No claims yet."}{" "}
          <a href="#/new">Submit a claim</a>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="claims-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Claimant</th>
                <th>Date</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>AI</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {claims.data.map((c) => (
                <ClaimRow key={c.id} claim={c} config={config} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ClaimRow({ claim: c, config }: { claim: ClaimSummary; config: AppConfig }) {
  const open = () => navigate(`#/claims/${c.id}`);
  return (
    <tr className="clickable" onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} tabIndex={0}>
      <td>{c.id}</td>
      <td>{c.claimant}</td>
      <td className="nowrap">{c.date}</td>
      <td>
        {categoryLabel(config, c.finalCategory ?? c.category)}
        {c.finalCategory && <span className="muted small"> (overridden)</span>}
      </td>
      <td className="num">{formatMoney(c.amount, c.currency)}</td>
      <td>
        <StatusBadge status={c.status} />
      </td>
      <td>
        {!c.latestAi ? (
          <span className="muted small">Not run</span>
        ) : c.latestAi.status !== "ok" ? (
          <span className="badge severity-warning">Unavailable</span>
        ) : (
          c.latestAi.uncertain && <UncertainBadge />
        )}
      </td>
      <td>
        <FlagCounts counts={c.validationCounts} />
      </td>
    </tr>
  );
}

function FlagCounts({ counts }: { counts: ClaimSummary["validationCounts"] }) {
  if (counts.error === 0 && counts.warning === 0) return <span className="muted small">None</span>;
  return (
    <span className="flag-counts">
      {counts.error > 0 && <span className="badge severity-error">{counts.error} error{counts.error > 1 && "s"}</span>}
      {counts.warning > 0 && (
        <span className="badge severity-warning">
          {counts.warning} warning{counts.warning > 1 && "s"}
        </span>
      )}
    </span>
  );
}
