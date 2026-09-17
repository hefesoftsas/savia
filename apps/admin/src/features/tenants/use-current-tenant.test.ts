import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  formatSlugToDisplayName,
  useCurrentTenant,
} from "./use-current-tenant";

describe("formatSlugToDisplayName", () => {
  it("formats single words to titlecase", () => {
    expect(formatSlugToDisplayName("merkaseguros")).toBe("Merkaseguros");
  });

  it("formats hyphenated and underscored words with spaces and titlecase", () => {
    expect(formatSlugToDisplayName("merka-seguros")).toBe("Merka Seguros");
    expect(formatSlugToDisplayName("alpha_beta-gamma")).toBe("Alpha Beta Gamma");
  });
});

describe("useCurrentTenant", () => {
  it("returns canonical platform tenant info when on canonical hostname", () => {
    const { result } = renderHook(() =>
      useCurrentTenant({ hostname: "savia.app.hefesoft.com" }),
    );

    expect(result.current).toEqual({
      isDedicated: false,
      slug: null,
      name: "Savia",
      kind: "platform",
      id: null,
      monogram: "S",
      isPlatformAdmin: false,
      isLoading: false,
    });
  });

  it("returns canonical platform tenant info when on localhost", () => {
    const { result } = renderHook(() =>
      useCurrentTenant({ hostname: "localhost" }),
    );

    expect(result.current.isDedicated).toBe(false);
    expect(result.current.slug).toBeNull();
    expect(result.current.name).toBe("Savia");
  });

  it("returns dedicated tenant info with fallback name when on tenant subdomain", () => {
    const { result } = renderHook(() =>
      useCurrentTenant({ hostname: "merkaseguros.savia.app.hefesoft.com" }),
    );

    expect(result.current.isDedicated).toBe(true);
    expect(result.current.slug).toBe("merkaseguros");
    expect(result.current.name).toBe("Merkaseguros");
    expect(result.current.monogram).toBe("M");
    expect(result.current.kind).toBe("commercial");
  });
});
