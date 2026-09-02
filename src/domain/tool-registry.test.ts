import { describe, expect, it } from "vitest";
import { getToolContract, getToolContracts } from "./tool-registry";

describe("canonical tool registry", () => {
  it("changes the real destructive contract without duplicating definitions", () => {
    const weak = getToolContract("ambiguous", "delete_issue")!;
    const improved = getToolContract("improved", "delete_issue")!;

    expect(getToolContracts("improved")).toHaveLength(4);
    expect(weak.description).toBe("Remove an issue from the issue tracker.");
    expect(improved.description).toContain(
      "Permanently and irreversibly deletes",
    );
    expect(improved.description).toContain("permanent deletion is explicit");
    expect(improved.description).toContain("prefer close_issue");
  });

  it("publishes explicit composable search filters", () => {
    const search = getToolContract("improved", "search_issues")!;
    expect(search.inputSchema.properties).toMatchObject({
      query: { type: "string" },
      status: { type: "string" },
      limit: { type: "integer", default: 20 },
    });
  });
});
