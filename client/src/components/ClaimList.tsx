import { api } from "../api";
import { categoryLabel, formatMoney, STATUS_LABELS } from "../format";
import { useAsync } from "../hooks";
import { navigate, useLocation } from "../router";
import type { AppConfig, ClaimPage, ClaimStatus, ClaimSummary } from "../types";
import { Card, Empty, ErrorBox, Loading, StatusBadge, UncertainBadge } from "./ui";

// The reviewer's queue, one page at a time. Page, page size and status filter
// live in the URL (/claims?page=2&limit=25&status=approved), so refresh, the
// back button and shared links all show the same page.

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_LIMIT = 10;

interface ListQuery {
  page: number;
  limit: number;
  status: ClaimStatus | "";
}

// Reads the URL leniently: anything odd falls back to a default rather than
// showing an error for a hand-edited link.
function readQuery(search: string): ListQuery {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));
  const limit = Number(params.get("limit"));
  const status = params.get("status") ?? "";
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    limit: PAGE_SIZES.includes(limit) ? limit : DEFAULT_LIMIT,
    status: status in STATUS_LABELS ? (status as ClaimStatus) : "",
  };
}

// Writes only non-default values, so the plain list stays at "/claims".
function writeQuery({ page, limit, status }: ListQuery): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (limit !== DEFAULT_LIMIT) params.set("limit", String(limit));
  if (page !== 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/claims?${qs}` : "/claims";
}

export function ClaimList({ config }: { config: AppConfig }) {
  const { search } = useLocation();
  const query = readQuery(search);
  const claims = useAsync(
    () => api.listClaims({ page: query.page, limit: query.limit, status: query.status || undefined }),
    [query.page, query.limit, query.status],
  );

  // Changing the filter or page size goes back to page 1: page 3 of the old
  // result may not exist in the new one.
  const update = (changes: Partial<ListQuery>) => navigate(writeQuery({ ...query, page: 1, ...changes }));

  const controls = (
    <div className="row wrap">
      <label className="inline-label">
        Status
        <select value={query.status} onChange={(e) => update({ status: e.target.value as ClaimStatus | "" })}>
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
    <Card title="Claims" actions={controls}>
      {claims.error ? (
        <ErrorBox error={claims.error} onRetry={claims.reload} />
      ) : !claims.data ? (
        <Loading />
      ) : claims.data.total === 0 ? (
        <Empty>{query.status ? `No claims with status "${STATUS_LABELS[query.status]}".` : "No claims yet."}</Empty>
      ) : claims.data.items.length === 0 ? (
        // A bookmarked or hand-typed page that no longer exists.
        <Empty>
          There is no page {query.page}.{" "}
          <button type="button" className="btn btn-small" onClick={() => update({ page: claims.data!.totalPages })}>
            Go to the last page
          </button>
        </Empty>
      ) : (
        <>
          <div className={`table-wrap ${claims.loading ? "is-loading" : ""}`}>
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
                {claims.data.items.map((c) => (
                  <ClaimRow key={c.id} claim={c} config={config} />
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={claims.data} onPage={(page) => update({ page })} onLimit={(limit) => update({ limit })} />
        </>
      )}
    </Card>
  );
}

function Pager({ data, onPage, onLimit }: { data: ClaimPage; onPage: (page: number) => void; onLimit: (limit: number) => void }) {
  const first = (data.page - 1) * data.limit + 1;
  const last = first + data.items.length - 1;
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="muted small">
        Showing {first}–{last} of {data.total} claim{data.total === 1 ? "" : "s"}
      </span>
      <div className="row">
        <button type="button" className="btn btn-small" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
          ← Previous
        </button>
        <span className="small">
          Page {data.page} of {Math.max(data.totalPages, 1)}
        </span>
        <button
          type="button"
          className="btn btn-small"
          disabled={data.page >= data.totalPages}
          onClick={() => onPage(data.page + 1)}
        >
          Next →
        </button>
      </div>
      <label className="inline-label small">
        Per page
        <select value={data.limit} onChange={(e) => onLimit(Number(e.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </label>
    </nav>
  );
}

function ClaimRow({ claim: c, config }: { claim: ClaimSummary; config: AppConfig }) {
  const open = () => navigate(`/claims/${c.id}`);
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
