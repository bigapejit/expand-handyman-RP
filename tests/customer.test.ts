import { describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  displayPhone,
  formatPhone,
  normalizeEmail,
  parseCustomer,
} from "../lib/customer";

const valid = {
  name: "Jane Doe",
  site: "12 Oak Street",
  email: "",
  phone: "5551234567",
};

describe("formatPhone", () => {
  test("masks digits as the owner types", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("5")).toBe("(5");
    expect(formatPhone("555")).toBe("(555");
    expect(formatPhone("5551")).toBe("(555) 1");
    expect(formatPhone("555123")).toBe("(555) 123");
    expect(formatPhone("5551234567")).toBe("(555) 123-4567");
  });
  test("ignores characters the owner pastes in", () => {
    expect(formatPhone("+1 (555) 123-4567")).toBe("(555) 123-4567");
    expect(formatPhone("555.123.4567 ext")).toBe("(555) 123-4567");
  });
  test("strips a leading 1 and refuses to grow past ten digits", () => {
    expect(formatPhone("15551234567")).toBe("(555) 123-4567");
    expect(formatPhone("555123456789")).toBe("(555) 123-4567");
  });
});

describe("displayPhone", () => {
  test("renders stored E.164 for people", () => {
    expect(displayPhone("+15551234567")).toBe("(555) 123-4567");
  });
  test("leaves unmigrated rows exactly as they were saved", () => {
    expect(displayPhone("call the office")).toBe("call the office");
    expect(displayPhone("")).toBe("");
  });
});

describe("normalizeEmail", () => {
  test("trims and lowercases", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
  });
});

describe("parseCustomer", () => {
  test("stores the phone as E.164 and trims the rest", () => {
    const customer = parseCustomer({
      ...valid,
      name: "  Jane Doe ",
      site: " 12 Oak Street ",
      phone: "(555) 123-4567",
    });
    expect(customer).toEqual({
      name: "Jane Doe",
      site: "12 Oak Street",
      email: "",
      phone: "+15551234567",
    });
  });
  test("normalizes the email", () => {
    expect(
      parseCustomer({ ...valid, email: "  Jane@Example.COM " }).email,
    ).toBe("jane@example.com");
  });
  test("tolerates a leading 1", () => {
    expect(parseCustomer({ ...valid, phone: "1 555 123 4567" }).phone).toBe(
      "+15551234567",
    );
  });
  test("requires a name and a site", () => {
    expect(() => parseCustomer({ ...valid, name: "   " })).toThrow(
      /customer name/i,
    );
    expect(() => parseCustomer({ ...valid, site: "" })).toThrow(
      /service address/i,
    );
  });
  test("requires an email or a phone", () => {
    expect(() => parseCustomer({ ...valid, phone: "", email: "" })).toThrow(
      "Add an email or phone number.",
    );
  });
  test("rejects a phone that is not a ten-digit US number", () => {
    for (const phone of ["555123456", "+44 20 7946 0958", "abcdefghij"])
      expect(() => parseCustomer({ ...valid, phone })).toThrow(
        "Enter a valid US phone number.",
      );
  });
  test("rejects a malformed email", () => {
    expect(() => parseCustomer({ ...valid, email: "jane@" })).toThrow(
      "Enter a valid email address.",
    );
  });
  test("rejects fields over the 500 character cap", () => {
    expect(() => parseCustomer({ ...valid, site: "x".repeat(501) })).toThrow();
  });
});

describe("addCustomer", () => {
  const owner = () => {
    vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
    vi.stubEnv("OWNER_CLERK_ID", "");
    return convexTest(schema, import.meta.glob("../convex/**/*.ts")).withIdentity(
      { subject: "owner", email: "andrew@cogtex.ai", emailVerified: true },
    );
  };
  test("normalizes what the dialog sends", async () => {
    const t = owner();
    const id = await t.mutation(api.documents.addCustomer, {
      ...valid,
      email: "  Jane@Example.COM ",
      phone: "(555) 123-4567",
    });
    const saved = await t.run((ctx) => ctx.db.get(id));
    expect(saved).toMatchObject({
      email: "jane@example.com",
      phone: "+15551234567",
    });
  });
  test("rejects a bad phone even when the client sends it anyway", async () => {
    await expect(
      owner().mutation(api.documents.addCustomer, {
        ...valid,
        phone: "555-12",
      }),
    ).rejects.toThrow("Enter a valid US phone number.");
  });
  test("rejects a bad email even when the client sends it anyway", async () => {
    await expect(
      owner().mutation(api.documents.addCustomer, {
        ...valid,
        email: "not-an-email",
      }),
    ).rejects.toThrow("Enter a valid email address.");
  });
  test("rejects a customer with no way to contact them", async () => {
    await expect(
      owner().mutation(api.documents.addCustomer, {
        ...valid,
        email: "",
        phone: "",
      }),
    ).rejects.toThrow("Add an email or phone number.");
  });
});
