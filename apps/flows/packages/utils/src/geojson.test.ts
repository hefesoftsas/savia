import { describe, expect, it } from "vitest";

import { geojsonToSvg } from "./geojson";

const POINT = {
  type: "Point",
  coordinates: [0, 0],
};

describe("geojsonToSvg", () => {
  it("rejects long malformed RGB and HSL values", () => {
    const whitespace = "\t".repeat(100_000);

    const result = geojsonToSvg(POINT, {
      strokeColor: `hsl(${whitespace}x)`,
      fillColor: `rgb(${whitespace}x)`,
    });

    expect(result.error).toBeNull();
    expect(result.svg).toContain('stroke="#3b82f6"');
    expect(result.svg).toContain('fill="none"');
  });

  it("preserves safe CSS functional colors", () => {
    const result = geojsonToSvg(POINT, {
      strokeColor: "RGBA( 10, 20, 30, 0.5 )",
      backgroundColor: "hsl( 120, 50%, 50% )",
    });

    expect(result.svg).toContain('stroke="RGBA( 10, 20, 30, 0.5 )"');
    expect(result.svg).toContain('fill="hsl( 120, 50%, 50% )"');
  });

  it("escapes dimensions before inserting them into SVG attributes", () => {
    const result = geojsonToSvg(POINT, {
      width: '1" onload="alert(1)' as unknown as number,
      height: "<svg onload='alert(1)'" as unknown as number,
    });

    expect(result.svg).toContain('width="1&quot; onload=&quot;alert(1)"');
    expect(result.svg).toContain('height="&lt;svg onload=&#39;alert(1)&#39;"');
    expect(result.svg).not.toContain("<svg onload=");
  });
});
