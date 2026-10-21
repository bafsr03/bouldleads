import { describe, expect, it } from "vitest";
import { merge, render, spin } from "@/lib/outreach/render";

describe("spin", () => {
  it("is deterministic per seed and leaves merge tags alone", () => {
    const t = "{Hi|Hello|Hey} {{business_name}}";
    expect(spin(t, "1:0")).toBe(spin(t, "1:0"));
    expect(spin(t, "1:0")).toMatch(/^(Hi|Hello|Hey) \{\{business_name\}\}$/);
  });

  it("varies across seeds", () => {
    const outs = new Set(Array.from({ length: 30 }, (_, i) => spin("{a|b|c|d}", String(i))));
    expect(outs.size).toBeGreaterThan(1);
  });

  it("does not treat merge-tag fallbacks as spintax", () => {
    for (let i = 0; i < 20; i++) {
      expect(render("{Hi|Hello} in {{city|your area}}", { business_name: "x", city: null }, String(i))).toMatch(/^(Hi|Hello) in your area$/);
    }
    expect(render("{{category|businesses}}", { business_name: "x", category: "dentist" }, "s")).toBe("dentist");
  });

  it("handles nested spintax", () => {
    expect(spin("{x|{y|z}}", "s")).toMatch(/^[xyz]$/);
  });
});

describe("merge", () => {
  it("fills values and fallbacks", () => {
    expect(merge("{{business_name}} in {{city|your area}}", { business_name: "Joe's", city: null })).toBe("Joe's in your area");
    expect(merge("{{ city }}", { business_name: "x", city: "Austin" })).toBe("Austin");
  });

  it("does not let business names inject spintax", () => {
    const out = render("{Hi|Hi} {{business_name}}", { business_name: "Pipes {A|B} & Co" }, "seed");
    expect(out).toBe("Hi Pipes {A|B} & Co");
  });

  it("collapses blank lines left by empty tags", () => {
    expect(render("Hi\n\n{{personal_line}}\n\nBody", { business_name: "x", personal_line: "" }, "s")).toBe("Hi\n\nBody");
  });
});
