import { describe, expect, it } from "vitest";
import { rowsOf } from "@/db";

// Regression for the dual-driver raw-SQL shape bug (2026-07-07): postgres.js
// returns an iterable RowList, the Neon serverless driver returns node-postgres
// style { rows }. Both must normalize; /admin/tags and hub_stats crashed on prod
// because only the postgres.js shape was handled.

describe("rowsOf", () => {
  it("passes arrays through (postgres.js RowList shape)", () => {
    expect(rowsOf<{ a: number }>([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("unwraps { rows } (Neon serverless / node-postgres shape)", () => {
    const result = { command: "SELECT", rowCount: 1, rows: [{ a: 1 }], fields: [] };
    expect(rowsOf<{ a: number }>(result)).toEqual([{ a: 1 }]);
  });

  it("returns empty for anything else rather than throwing", () => {
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf({ rows: "nope" })).toEqual([]);
  });
});
