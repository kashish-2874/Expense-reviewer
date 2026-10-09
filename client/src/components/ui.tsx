import type { ReactNode } from "react";
import { STATUS_LABELS } from "../format";
import type { ClaimStatus, Severity } from "../types";

// Small presentational building blocks shared by every screen.

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge severity-${severity}`}>{severity}</span>;
}

export function UncertainBadge() {
  return (
    <span className="badge uncertain" title="The AI was not confident about the category">
      Uncertain
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <span>{error.message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
