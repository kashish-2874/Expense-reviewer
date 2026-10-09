import { useState } from "react";
import { api } from "./api";
import { ClaimDetail } from "./components/ClaimDetail";
import { ClaimForm } from "./components/ClaimForm";
import { ClaimList } from "./components/ClaimList";
import { TotalsPanel } from "./components/TotalsPanel";
import { ErrorBox, Loading } from "./components/ui";
import { useAsync, useRoute } from "./hooks";

// Top-level layout and screen switching. Config (categories, currencies) is
// loaded once and passed down; everything else loads per screen.

export function App() {
  const route = useRoute();
  const config = useAsync(() => api.config(), []);
  // Bumped after a decision so the totals panel refetches.
  const [changes, setChanges] = useState(0);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          Expense Claim Review
        </a>
        <span className="tagline">AI advises · rules enforce · you decide</span>
        <a href="#/new" className="btn btn-primary">
          New claim
        </a>
      </header>

      <main className="layout">
        {config.error ? (
          <ErrorBox error={config.error} onRetry={config.reload} />
        ) : !config.data ? (
          <Loading />
        ) : route.name === "new" ? (
          <ClaimForm config={config.data} />
        ) : route.name === "claim" ? (
          <ClaimDetail key={route.id} id={route.id} config={config.data} onChanged={() => setChanges((n) => n + 1)} />
        ) : (
          <div className="list-layout">
            <ClaimList config={config.data} />
            <aside>
              <TotalsPanel config={config.data} refreshKey={changes} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
