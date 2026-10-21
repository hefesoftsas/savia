import { render, screen, act, cleanup } from "@testing-library/react";
import { describe, expect, it, afterEach } from "vitest";
import { useState } from "react";
import {
  ActiveScreenContextProvider,
  useActiveScreenContext,
  useRegisterScreenContext,
  type ActiveScreenContextValue,
} from "./active-screen-context";

function CurrentContextViewer() {
  const context = useActiveScreenContext();
  return (
    <div data-testid="viewer">
      {context ? JSON.stringify(context) : "none"}
    </div>
  );
}

function MockScreen({
  screenContext,
}: {
  screenContext: ActiveScreenContextValue;
}) {
  useRegisterScreenContext(screenContext);
  return <div data-testid="mock-screen">Screen mounted</div>;
}

describe("ActiveScreenContext", () => {
  afterEach(() => {
    cleanup();
  });

  it("defaults to null when no screen has registered context", () => {
    render(
      <ActiveScreenContextProvider>
        <CurrentContextViewer />
      </ActiveScreenContextProvider>,
    );

    expect(screen.getByTestId("viewer").textContent).toBe("none");
  });

  it("updates current context when a screen registers and clears on unmount", () => {
    function TestApp() {
      const [mounted, setMounted] = useState(true);
      return (
        <ActiveScreenContextProvider>
          <CurrentContextViewer />
          <button type="button" onClick={() => setMounted(!mounted)}>
            Toggle
          </button>
          {mounted && (
            <MockScreen
              screenContext={{
                route: "/studio/quotes/QT-1",
                entityType: "quote",
                entityId: "QT-1",
                summary: "Quote QT-1 in draft",
              }}
            />
          )}
        </ActiveScreenContextProvider>
      );
    }

    render(<TestApp />);

    expect(screen.getByTestId("viewer").textContent).toContain("QT-1");
    expect(screen.getByTestId("viewer").textContent).toContain(
      "Quote QT-1 in draft",
    );

    act(() => {
      screen.getByRole("button", { name: "Toggle" }).click();
    });

    expect(screen.getByTestId("viewer").textContent).toBe("none");
  });
});
