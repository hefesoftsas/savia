import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createAdminQueryClient } from "@/queries/query-policy";
import { readKey } from "@/queries/query-keys";
import { deriveReadState, isReadAccessDenied } from "@/queries/read-state";
import { getSessionGeneration, rotateSessionScope } from "@/auth/session-scope";
import { scheduleReadInvalidation } from "../../read-invalidation";
import "@/styles/globals.css";

type ReadOutcome = "success" | "error" | "denied";
type PreviewData = { revision: number };
type PendingRead = {
  resolve: (data: PreviewData) => void;
  reject: (error: Error) => void;
};

const queryClient = createAdminQueryClient();
let nextConsumerInstance = 0;

function ReadConsumer({
  label,
  tenantId,
  sessionGeneration,
  queryFn,
}: {
  label: string;
  tenantId: string;
  sessionGeneration: number;
  queryFn: () => Promise<PreviewData>;
}) {
  const [instance] = useState(() => ++nextConsumerInstance);
  const renders = useRef(0);
  renders.current += 1;
  const queryKey = readKey(
    { sessionGeneration, kind: "tenant", id: tenantId },
    "read-stability-preview",
  );
  const query = useQuery({
    queryKey,
    queryFn,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const state = deriveReadState({
    scopeReady: true,
    hasData: query.data !== undefined,
    fetching: query.isFetching,
    error: query.error,
    accessDenied: isReadAccessDenied(query.error),
  });

  return (
    <article className="grid gap-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Consumer {label}</h2>
      <p>
        Mounted instance:{" "}
        <strong data-testid={`instance-${label}`}>{instance}</strong>
      </p>
      <p>
        Read state: <strong data-testid={`read-state-${label}`}>{state}</strong>
      </p>
      <p>
        Query revision: <strong>{query.data?.revision ?? "none"}</strong>
      </p>
      <p>
        Render count:{" "}
        <strong data-testid={`render-count-${label}`}>{renders.current}</strong>
      </p>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
    </article>
  );
}

function ReadStabilityPreview() {
  const [tenantId, setTenantId] = useState("tenant-a");
  const [sessionGeneration, setSessionGeneration] = useState(
    getSessionGeneration(),
  );
  const [reads, setReads] = useState(0);
  const [hints, setHints] = useState(0);
  const [profileEvents, setProfileEvents] = useState(0);
  const [holdNextRead, setHoldNextRead] = useState(false);
  const [hasHeldRead, setHasHeldRead] = useState(false);
  const [draft, setDraft] = useState("Draft survives same-tab refreshes");
  const heldRead = useRef<PendingRead | null>(null);
  const holdReadRef = useRef(false);
  const nextOutcome = useRef<ReadOutcome>("success");
  const revision = useRef(0);
  const scope = { sessionGeneration, tenantId };
  const queryKey = readKey(
    { sessionGeneration, kind: "tenant", id: tenantId },
    "read-stability-preview",
  );

  const queryFn = useCallback(async (): Promise<PreviewData> => {
    setReads((current) => current + 1);
    const outcome = nextOutcome.current;
    nextOutcome.current = "success";

    if (holdReadRef.current) {
      holdReadRef.current = false;
      setHoldNextRead(false);
      setHasHeldRead(true);
      return new Promise((resolve, reject) => {
        heldRead.current = { resolve, reject };
      });
    }

    if (outcome === "error") throw new Error("Temporary read failure");
    if (outcome === "denied") {
      throw Object.assign(new Error("Read access denied (403)"), {
        status: 403,
      });
    }
    revision.current += 1;
    return { revision: revision.current };
  }, []);

  const sendHints = (count: number) => {
    setHints((current) => current + count);
    for (let index = 0; index < count; index += 1) {
      void scheduleReadInvalidation(queryClient, [queryKey]).catch(() => {});
    }
  };

  const completeHeldRead = (outcome: ReadOutcome) => {
    const pending = heldRead.current;
    if (pending) {
      heldRead.current = null;
      setHasHeldRead(false);
      if (outcome === "error")
        pending.reject(new Error("Temporary read failure"));
      else if (outcome === "denied") {
        pending.reject(
          Object.assign(new Error("Read access denied (403)"), { status: 403 }),
        );
      } else {
        revision.current += 1;
        pending.resolve({ revision: revision.current });
      }
      return;
    }

    nextOutcome.current = outcome;
    sendHints(1);
  };

  const retry = () => {
    nextOutcome.current = "success";
    void scheduleReadInvalidation(queryClient, [queryKey], {
      immediate: true,
    }).catch(() => {});
  };

  const rotatePrincipal = () => {
    rotateSessionScope("principal-change");
    setSessionGeneration(getSessionGeneration());
  };

  if (!import.meta.env.DEV) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Development preview only</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6">
      <header className="grid gap-2">
        <p className="text-sm font-medium text-primary">
          Local acceptance fixture
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Shared read stability
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Synthetic in-memory reads only. This page makes no server requests and
          stores no data in browser storage.
        </p>
      </header>

      <section
        aria-label="Read scope and counters"
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
      >
        <p>
          Scope: <strong data-testid="read-scope">{tenantId}</strong>
        </p>
        <p>
          Session generation:{" "}
          <strong data-testid="session-generation">{sessionGeneration}</strong>
        </p>
        <p>
          Read calls: <strong data-testid="read-count">{reads}</strong>
        </p>
        <p>
          Accepted hints: <strong data-testid="hint-count">{hints}</strong>
        </p>
        <p>
          Profile events:{" "}
          <strong data-testid="profile-event-count">{profileEvents}</strong>
        </p>
        <p>
          Active query consumers: <strong>2</strong>
        </p>
      </section>

      <section
        aria-label="Read controls"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={() => sendHints(10)}
        >
          Send 10 hint burst
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          aria-pressed={holdNextRead}
          onClick={() => {
            holdReadRef.current = true;
            setHoldNextRead(true);
          }}
        >
          Hold next read{holdNextRead ? " (armed)" : ""}
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          disabled={!hasHeldRead}
          onClick={() => completeHeldRead("success")}
        >
          Resolve held read successfully
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={() => completeHeldRead("error")}
        >
          Temporary error
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={() => completeHeldRead("denied")}
        >
          Deny read with 403
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={retry}
        >
          Retry as success
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={() =>
            setTenantId((current) =>
              current === "tenant-a" ? "tenant-b" : "tenant-a",
            )
          }
        >
          Switch tenant scope
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={() => {
            setProfileEvents((current) => current + 1);
            sendHints(1);
          }}
        >
          Simulate profile event (same principal)
        </button>
        <button
          className="rounded-lg border bg-card p-3 text-left"
          onClick={rotatePrincipal}
        >
          Rotate principal session
        </button>
      </section>

      <label className="grid gap-2 rounded-xl border bg-card p-4 text-sm font-medium">
        Persistent in-memory draft
        <input
          className="min-h-11 rounded-md border bg-background px-3 font-normal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          data-testid="persistent-draft"
        />
      </label>

      <section
        aria-label="Shared read consumers"
        className="grid gap-3 sm:grid-cols-2"
      >
        <ReadConsumer
          label="A"
          tenantId={scope.tenantId}
          sessionGeneration={scope.sessionGeneration}
          queryFn={queryFn}
        />
        <ReadConsumer
          label="B"
          tenantId={scope.tenantId}
          sessionGeneration={scope.sessionGeneration}
          queryFn={queryFn}
        />
      </section>

      <p
        aria-live="polite"
        role="status"
        className="text-sm text-muted-foreground"
      >
        {hasHeldRead
          ? "A read is held. Choose success, temporary error, or 403 to release it."
          : holdNextRead
            ? "The next scheduled read will be held."
            : "The two consumers share one session and tenant query key."}
      </p>
    </main>
  );
}

if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <QueryClientProvider client={queryClient}>
      <ReadStabilityPreview />
    </QueryClientProvider>,
  );
}

import.meta.hot?.dispose(() => queryClient.clear());
