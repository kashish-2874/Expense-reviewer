import { api } from "../api";
import { categoryLabel, formatMoney } from "../format";
import { useAsync } from "../hooks";
import type { AppConfig } from "../types";
import { Card, Empty, ErrorBox, Loading } from "./ui";

// Totals per claimant and per category, computed by the server in INR.

export function TotalsPanel({ config, refreshKey }: { config: AppConfig; refreshKey?: unknown }) {
  const totals = useAsync(() => api.totals(), [refreshKey]);

  return (
    <Card title="Totals">
      {totals.error ? (
        <ErrorBox error={totals.error} onRetry={totals.reload} />
      ) : !totals.data ? (
        <Loading />
      ) : totals.data.claimCount === 0 ? (
        <Empty>No claims to total.</Empty>
      ) : (
        <>
          <p className="grand-total">
            {formatMoney(totals.data.grandTotal, totals.data.baseCurrency)}
            <span className="muted small"> across {totals.data.claimCount} claims</span>
          </p>
          <TotalsTable
            title="By claimant"
            rows={totals.data.byClaimant}
            currency={totals.data.baseCurrency}
            label={(k) => k}
          />
          <TotalsTable
            title="By category"
            rows={totals.data.byCategory}
            currency={totals.data.baseCurrency}
            label={(k) => categoryLabel(config, k)}
          />
          <p className="muted small">
            Rejected claims are excluded. Reviewer overrides are applied. Foreign currencies use fixed demo rates.
            {totals.data.skippedClaimCount > 0 && ` ${totals.data.skippedClaimCount} claim(s) skipped: unknown currency.`}
          </p>
        </>
      )}
    </Card>
  );
}

function TotalsTable(props: { title: string; rows: Record<string, number>; currency: string; label: (k: string) => string }) {
  const entries = Object.entries(props.rows).sort((a, b) => b[1] - a[1]);
  return (
    <table className="totals-table">
      <thead>
        <tr>
          <th>{props.title}</th>
          <th className="num">{props.currency}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <td>{props.label(key)}</td>
            <td className="num">{formatMoney(value, props.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
