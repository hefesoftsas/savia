import type { CSSProperties } from "react";

export function QuoteWizardSkeleton({
  isWizard = true,
}: {
  isWizard?: boolean;
}) {
  return (
    <div
      className="insurance-quote"
      role="status"
      aria-label="Cargando cotizador de seguros…"
    >
      <span className="sr-only">Cargando cotizador de seguros…</span>

      {/* Header */}
      <header className="insurance-quote__header">
        <div className="insurance-quote__title-wrap">
          <div
            className="quote-skeleton"
            style={{ height: "12px", width: "160px", marginBottom: "6px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "28px", width: "240px" }}
          />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <div
            className="quote-skeleton"
            style={{ height: "36px", width: "140px", borderRadius: "999px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "36px", width: "110px", borderRadius: "999px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "36px", width: "90px", borderRadius: "999px" }}
          />
        </div>
      </header>

      {/* Stepper (if wizard) */}
      {isWizard ? (
        <nav
          aria-label="Pasos de la cotización"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px",
            margin: "24px 0 20px",
          }}
        >
          <div
            className="quote-skeleton"
            style={{ height: "38px", borderRadius: "8px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "38px", borderRadius: "8px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "38px", borderRadius: "8px" }}
          />
        </nav>
      ) : null}

      {/* Form card */}
      <section
        style={{
          borderRadius: "12px",
          border: "1px solid var(--border, #e5e7eb)",
          padding: "24px",
          background: "var(--card, #ffffff)",
          marginTop: isWizard ? "0" : "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            paddingBottom: "16px",
            borderBottom: "1px solid var(--border, #e5e7eb)",
          }}
        >
          <div
            className="quote-skeleton"
            style={{ height: "20px", width: "180px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "28px", width: "100px", borderRadius: "6px" }}
          />
        </div>

        {/* Input fields grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            <div
              className="quote-skeleton"
              style={{ height: "14px", width: "80px" }}
            />
            <div
              className="quote-skeleton"
              style={{ height: "42px", width: "100%", borderRadius: "8px" }}
            />
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            <div
              className="quote-skeleton"
              style={{ height: "14px", width: "120px" }}
            />
            <div
              className="quote-skeleton"
              style={{ height: "42px", width: "100%", borderRadius: "8px" }}
            />
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            <div
              className="quote-skeleton"
              style={{ height: "14px", width: "100px" }}
            />
            <div
              className="quote-skeleton"
              style={{ height: "42px", width: "100%", borderRadius: "8px" }}
            />
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            <div
              className="quote-skeleton"
              style={{ height: "14px", width: "140px" }}
            />
            <div
              className="quote-skeleton"
              style={{ height: "42px", width: "100%", borderRadius: "8px" }}
            />
          </div>
        </div>

        {/* Footer actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "16px",
            borderTop: "1px solid var(--border, #e5e7eb)",
          }}
        >
          <div
            className="quote-skeleton"
            style={{ height: "40px", width: "100px", borderRadius: "8px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "40px", width: "140px", borderRadius: "8px" }}
          />
        </div>
      </section>
    </div>
  );
}

export function InsuranceAdminSkeleton() {
  return (
    <div
      className="insurance-admin"
      role="status"
      aria-label="Cargando configuración de seguros…"
      style={{
        marginTop: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      <span className="sr-only">Cargando configuración de seguros…</span>

      {/* Panel 1: Pantallas */}
      <section
        style={{
          borderRadius: "12px",
          border: "1px solid var(--border, #e5e7eb)",
          padding: "20px",
          background: "var(--card, #ffffff)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            paddingBottom: "12px",
            borderBottom: "1px solid var(--border, #e5e7eb)",
          }}
        >
          <div
            className="quote-skeleton"
            style={{ height: "18px", width: "120px" }}
          />
          <div
            className="quote-skeleton"
            style={{
              height: "20px",
              width: "20px",
              borderRadius: "999px",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              className="quote-skeleton"
              style={{ height: "18px", width: "18px", borderRadius: "4px" }}
            />
            <div
              className="quote-skeleton"
              style={{ height: "14px", width: "90px" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              className="quote-skeleton"
              style={{ height: "18px", width: "18px", borderRadius: "4px" }}
            />
            <div
              className="quote-skeleton"
              style={{ height: "14px", width: "140px" }}
            />
          </div>
        </div>
      </section>

      {/* Panel 2: Productos */}
      <section
        style={{
          borderRadius: "12px",
          border: "1px solid var(--border, #e5e7eb)",
          padding: "20px",
          background: "var(--card, #ffffff)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            paddingBottom: "12px",
            borderBottom: "1px solid var(--border, #e5e7eb)",
          }}
        >
          <div
            className="quote-skeleton"
            style={{ height: "18px", width: "100px" }}
          />
          <div
            className="quote-skeleton"
            style={{ height: "16px", width: "110px" }}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: "10px" }}
            >
              <div
                className="quote-skeleton"
                style={{
                  height: "18px",
                  width: "18px",
                  borderRadius: "4px",
                }}
              />
              <div
                className="quote-skeleton"
                style={{
                  height: "14px",
                  width: i % 2 === 0 ? "130px" : "100px",
                }}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
