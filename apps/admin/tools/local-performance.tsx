/** Developer-only fixture: synthetic records in an isolated database, never customer data. */
import React, { Profiler, memo, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CoreAdminContext } from "ra-core";
import { DataTable } from "../src/components/admin/data-table";
import { openLocalStore } from "../src/local-data/store";
import { queryRecords } from "../src/local-data/query";
import type { CrmObject, CrmRecord } from "@savia/crm-shared/metadata";
import "../src/styles/globals.css";
import "../src/features/crm-engine/style.css";
const object = {
  name: "benchmark",
  config: {
    fields: Object.fromEntries(
      ["name", "amount", "city", "status", "owner", "code"].map((name) => [
        name,
        { type: name === "amount" ? "Currency" : "Textbox" },
      ]),
    ),
  },
} as unknown as CrmObject;
const store = await openLocalStore("developer-performance-fixture");
const BenchmarkTable = memo(function BenchmarkTable({
  rows,
  virtual,
  onRender,
  onOpen,
}: {
  rows: CrmRecord[];
  virtual: boolean;
  onRender: React.ProfilerOnRenderCallback;
  onOpen: (name: string) => void;
}) {
  return (
    <Profiler id="records" onRender={onRender}>
      <DataTable
        key={virtual ? "virtual" : "full"}
        virtualize={virtual}
        className="records-table"
        resource="benchmark"
        data={rows}
        total={rows.length}
        isPending={false}
        bulkActionButtons={false}
        rowClick={(_id, _resource, row) => {
          onOpen(String(row.name));
          return false;
        }}
      >
        {Object.keys(object.config.fields).map((field) => (
          <DataTable.Col key={field} source={field} label={field} />
        ))}
      </DataTable>
    </Profiler>
  );
});
function App() {
  const [rows, setRows] = useState<CrmRecord[]>([]),
    [virtual, setVirtual] = useState(false),
    [opened, setOpened] = useState(""),
    [loading, setLoading] = useState(false);
  const result = useRef<HTMLOutputElement>(null),
    queryMs = useRef(0),
    started = useRef(0),
    renderMs = useRef(0),
    measuring = useRef(false);
  const measured = useCallback(
    (_id: string, phase: string, actualDuration: number) => {
      if (!measuring.current) return;
      renderMs.current += actualDuration;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          measuring.current = false;
          if (result.current)
            result.current.textContent = JSON.stringify(
              {
                phase,
                queryMs: Math.round(queryMs.current * 10) / 10,
                reactRenderMs: Math.round(renderMs.current * 10) / 10,
                queryToPaintMs:
                  Math.round((performance.now() - started.current) * 10) / 10,
                mountedRows: document.querySelectorAll(
                  "tbody tr:not([aria-hidden])",
                ).length,
                pageRows: 200,
              },
              null,
              2,
            );
        }),
      );
    },
    [],
  );
  async function prepare() {
    setLoading(true);
    await store.refreshManifest([
      { name: "benchmark", object, capability: "read-write", schemaVersion: 1 },
    ]);
    await store.applyPull("benchmark", {
      documents: Array.from({ length: 10000 }, (_, i) => ({
        id: String(i).padStart(5, "0"),
        name: `Customer ${i}`,
        amount: i * 10,
        city: "Bogotá",
        status: "Active",
        owner: `Agent ${i % 10}`,
        code: `B-${i}`,
        _version: 1,
        created_at: "2026-09-18",
        updated_at: "2026-09-18",
        deleted_at: null,
      })),
      cursor: "10000",
      hasMore: false,
    });
    setLoading(false);
    if (result.current)
      result.current.textContent = "10,000 synthetic records ready";
  }
  async function query(mode: boolean) {
    setLoading(true);
    renderMs.current = 0;
    started.current = performance.now();
    const t = performance.now();
    const page = await queryRecords(
      store.db,
      "benchmark",
      object,
      new URLSearchParams({
        q: "",
        perPage: "200",
        sort: "amount",
        order: "DESC",
      }),
    );
    queryMs.current = performance.now() - t;
    measuring.current = true;
    setVirtual(mode);
    setRows(page.data);
    setLoading(false);
  }
  return (
    <CoreAdminContext>
      <main className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">Local performance benchmark</h1>
        <p>Synthetic data · 10,000 records · 200-row pages · no API</p>
        <div className="flex flex-wrap gap-3">
          {[
            ["Prepare data", prepare],
            ["Measure full table", () => query(false)],
            ["Measure virtual table", () => query(true)],
          ].map(([label, fn]) => (
            <button
              className="rounded border px-3 py-2"
              key={String(label)}
              disabled={loading}
              onClick={() => void (fn as () => Promise<void>)()}
            >
              {String(label)}
            </button>
          ))}
        </div>
        <output ref={result} className="block whitespace-pre-wrap" />
        <p role="status">{opened}</p>
        <div className="savia-crm">
          <BenchmarkTable
            rows={rows}
            virtual={virtual}
            onRender={measured}
            onOpen={setOpened}
          />
        </div>
      </main>
    </CoreAdminContext>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
