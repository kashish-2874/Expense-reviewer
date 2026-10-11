import { useEffect, type ReactNode } from "react";
import { api } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { ClaimDetail } from "./components/ClaimDetail";
import { ClaimForm } from "./components/ClaimForm";
import { ClaimList } from "./components/ClaimList";
import { LoginPage } from "./components/LoginPage";
import { TotalsPanel } from "./components/TotalsPanel";
import { Card, ErrorBox, Loading } from "./components/ui";
import { useAsync } from "./hooks";
import { Link, navigate, useLocation } from "./router";
import type { AppConfig } from "./types";

// Top-level layout and the route table.
//   PUBLIC:    /submit-claim   submit a claim ("/" redirects here)
//              /login          reviewer login
//   PROTECTED: /claims         claim list + totals
//              /claims/:id     one claim
// Config (categories, currencies) is public and loaded once.

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const config = useAsync(() => api.config(), []);

  return (
    <div className="app">
      <Header />
      <main className="layout">
        {config.error ? (
          <ErrorBox error={config.error} onRetry={config.reload} />
        ) : !config.data ? (
          <Loading />
        ) : (
          <Page pathname={pathname} config={config.data} />
        )}
      </main>
    </div>
  );
}

function Page({ pathname, config }: { pathname: string; config: AppConfig }) {
  if (pathname === "/") return <Redirect to="/submit-claim" />;
  if (pathname === "/submit-claim") return <ClaimForm config={config} />;
  if (pathname === "/login") return <LoginPage />;
  if (pathname === "/claims") {
    return (
      <RequireAuth>
        <div className="list-layout">
          <ClaimList config={config} />
          <aside>
            <TotalsPanel config={config} />
          </aside>
        </div>
      </RequireAuth>
    );
  }
  const claim = /^\/claims\/(\d+)$/.exec(pathname);
  if (claim) {
    return (
      <RequireAuth>
        <ClaimDetail key={claim[1]} id={Number(claim[1])} config={config} />
      </RequireAuth>
    );
  }
  return (
    <Card title="Page not found">
      <p>
        <Link to="/submit-claim">Submit a claim</Link> or <Link to="/claims">go to the reviewer area</Link>.
      </p>
    </Card>
  );
}

// Replaces the current URL (so Back does not bounce through it).
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

// Shows the page only to a logged-in reviewer. Anyone else is sent to the
// login page, which brings them back here afterwards (?next=...).
function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (state.status === "anonymous") {
      navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true });
    }
  }, [state.status, pathname, search]);

  if (state.status !== "authenticated") return <Loading label="Checking your session…" />;
  return <>{children}</>;
}

function Header() {
  const { state, logout } = useAuth();
  return (
    <header className="topbar">
      <Link to="/submit-claim" className="brand">
        Expense Claim Review
      </Link>
      <span className="tagline">AI advises · rules enforce · you decide</span>
      <nav className="row">
        <Link to="/submit-claim" className="btn btn-link">
          Submit a claim
        </Link>
        {state.status === "authenticated" ? (
          <>
            <Link to="/claims" className="btn btn-link">
              Claims
            </Link>
            <span className="header-user small">
              Reviewer: <strong>{state.user.username}</strong>
            </span>
            <button type="button" className="btn btn-small" onClick={() => void logout()}>
              Logout
            </button>
          </>
        ) : (
          <Link to="/login" className="btn btn-primary">
            Reviewer login
          </Link>
        )}
      </nav>
    </header>
  );
}
