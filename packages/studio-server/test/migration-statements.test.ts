import { expect, it } from "vitest";
import { migrationStatements } from "./migration-statements";

it("keeps a marked multi-statement trigger body intact", () => {
  const source = `CREATE TRIGGER sample AFTER INSERT ON records BEGIN
    INSERT INTO audit VALUES (NEW.id);
    UPDATE counters SET total=total+1;
  END;
  --> statement-breakpoint
  CREATE INDEX records_id ON records(id);`;

  expect(migrationStatements(source)).toEqual([
    expect.stringContaining("UPDATE counters SET total=total+1;"),
    expect.stringContaining("CREATE INDEX records_id ON records(id);"),
  ]);
  expect(migrationStatements(source)[0]).toContain("END;");
});

it("retains legacy splitting for migrations without markers", () => {
  expect(
    migrationStatements(
      "CREATE TABLE records(id TEXT); CREATE INDEX records_id ON records(id);",
    ),
  ).toEqual([
    "CREATE TABLE records(id TEXT)",
    "CREATE INDEX records_id ON records(id)",
  ]);
});
