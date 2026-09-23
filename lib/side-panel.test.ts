import { describe, expect, it } from "vitest";

import { openPanelId, panelHref } from "./side-panel";

const tab = "/sites/site-1/solutions";

describe("The row a side panel has open", () => {
  it("opens a row by putting it on the URL", () => {
    expect(panelHref(tab, "", "solution", "sol-7")).toBe(`${tab}?solution=sol-7`);
  });

  // The whole point of the parameter: the link is the state.
  it("reads back the row the href it wrote says is open", () => {
    const href = panelHref(tab, "", "solution", "sol-7");
    expect(openPanelId(href.split("?")[1], "solution")).toBe("sol-7");
  });

  it("closes by taking the parameter off, not by emptying it", () => {
    expect(panelHref(tab, "solution=sol-7", "solution", null)).toBe(tab);
  });

  it("swaps one open row for another rather than stacking them", () => {
    expect(panelHref(tab, "solution=sol-7", "solution", "sol-9")).toBe(
      `${tab}?solution=sol-9`,
    );
  });

  it("carries every other parameter across, opening and closing", () => {
    expect(panelHref(tab, "version=3", "solution", "sol-7")).toBe(
      `${tab}?version=3&solution=sol-7`,
    );
    expect(panelHref(tab, "version=3&solution=sol-7", "solution", null)).toBe(
      `${tab}?version=3`,
    );
  });

  it("takes a search string however the browser hands it over", () => {
    expect(openPanelId("?solution=sol-7", "solution")).toBe("sol-7");
    expect(openPanelId("solution=sol-7", "solution")).toBe("sol-7");
  });

  it("has nothing open when the parameter is absent or empty", () => {
    expect(openPanelId("", "solution")).toBeNull();
    expect(openPanelId("version=3", "solution")).toBeNull();
    expect(openPanelId("solution=", "solution")).toBeNull();
  });

  // Two panels on one page would each own their own parameter; neither may
  // touch the other's.
  it("leaves another panel's parameter where it is", () => {
    expect(panelHref(tab, "proposal=pro-1", "solution", "sol-7")).toBe(
      `${tab}?proposal=pro-1&solution=sol-7`,
    );
  });
});
