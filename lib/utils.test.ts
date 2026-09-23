import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { errorMessage } from "./utils";

describe("errorMessage", () => {
  it("keeps only the message a Convex function threw", () => {
    expect(
      errorMessage(
        new Error(
          "[CONVEX A(places:suggest)] [Request ID: c85cd80967a6d639] Server Error Uncaught Error: Address lookup is not set up. Set GOOGLE_MAPS_API_KEY on this deployment.\n    at placesKey (../lib/places.ts:31:10)\n Called by client",
        ),
      ),
    ).toBe("Address lookup is not set up. Set GOOGLE_MAPS_API_KEY on this deployment.");
    expect(
      errorMessage(
        new Error(
          "[CONVEX M(sites:remove)] [Request ID: 1] Server Error Uncaught Error: This site has proposals, so it can't be deleted. Called by client",
        ),
      ),
    ).toBe("This site has proposals, so it can't be deleted.");
  });

  it("says the message a refusal carries as its data", () => {
    const data = { code: "no_email", message: "The customer has no email address to send it to." };
    expect(errorMessage(new ConvexError(data))).toBe(data.message);
    // Handed on through an action, the data can arrive still as JSON.
    expect(errorMessage(new ConvexError(JSON.stringify(data)))).toBe(data.message);
  });

  it("leaves a plain message alone", () => {
    expect(errorMessage(new Error("Choose a PDF under 20 MB."))).toBe(
      "Choose a PDF under 20 MB.",
    );
    expect(errorMessage("nope")).toBe("Something went wrong. Please try again.");
  });
});
