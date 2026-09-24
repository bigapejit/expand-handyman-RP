import { describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import {
  contactWarnings,
  displayPhone,
  findCustomers,
  formatPhone,
  normalizeEmail,
  parseCustomer,
  parseDealCustomer,
} from "../lib/customer";

const valid = {
  name: "Jane Doe",
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
      phone: "(555) 123-4567",
    });
    expect(customer).toEqual({
      name: "Jane Doe",
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
  test("requires a name", () => {
    expect(() => parseCustomer({ ...valid, name: "   " })).toThrow(
      /customer name/i,
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
    expect(() => parseCustomer({ ...valid, name: "x".repeat(501) })).toThrow();
  });
});

describe("parseDealCustomer", () => {
  test("takes a name alone, as the New deal dialog may", () => {
    expect(parseDealCustomer({ name: " Tom Brandt ", email: "", phone: "" })).toEqual({
      name: "Tom Brandt",
      email: "",
      phone: "",
    });
  });
  test("still refuses a bad phone or email when one is typed", () => {
    expect(() => parseDealCustomer({ name: "Tom", email: "", phone: "555-12" })).toThrow(
      "Enter a valid US phone number.",
    );
    expect(() => parseDealCustomer({ name: "Tom", email: "tom@", phone: "" })).toThrow(
      "Enter a valid email address.",
    );
  });
  test("requires a name", () => {
    expect(() => parseDealCustomer({ name: "  ", email: "", phone: "" })).toThrow(
      /customer name/i,
    );
  });
});

describe("customers.add", () => {
  const owner = () => {
    vi.stubEnv("OWNER_EMAIL", "andrew@cogtex.ai");
    vi.stubEnv("OWNER_CLERK_ID", "");
    return convexTest(schema, import.meta.glob("../convex/**/*.ts")).withIdentity(
      { subject: "owner", email: "andrew@cogtex.ai", emailVerified: true },
    );
  };
  test("normalizes what the dialog sends", async () => {
    const t = owner();
    const { customerId, siteId } = await t.action(api.customers.add, {
      ...valid,
      email: "  Jane@Example.COM ",
      phone: "(555) 123-4567",
    });
    expect(siteId).toBeNull();
    const saved = await t.run((ctx) => ctx.db.get(customerId));
    expect(saved).toMatchObject({
      email: "jane@example.com",
      phone: "+15551234567",
    });
  });
  test("rejects a bad phone even when the client sends it anyway", async () => {
    await expect(
      owner().action(api.customers.add, {
        ...valid,
        phone: "555-12",
      }),
    ).rejects.toThrow("Enter a valid US phone number.");
  });
  test("rejects a bad email even when the client sends it anyway", async () => {
    await expect(
      owner().action(api.customers.add, {
        ...valid,
        email: "not-an-email",
      }),
    ).rejects.toThrow("Enter a valid email address.");
  });
  test("rejects a customer with no way to contact them", async () => {
    await expect(
      owner().action(api.customers.add, {
        ...valid,
        email: "",
        phone: "",
      }),
    ).rejects.toThrow("Add an email or phone number.");
  });
});

describe("contactWarnings", () => {
  const others = [
    { _id: "harlow", name: "Harlow Property Group", email: "ops@harlow.example", phone: "+13605550118" },
    // Saved before validation, so still raw.
    { _id: "ben", name: "Ben Okafor", email: " Ben@Example.com", phone: "360.555.0177" },
  ];
  test("names the other customer using the same email or phone", () => {
    expect(
      contactWarnings({ name: "", email: "OPS@harlow.example ", phone: "(360) 555-0177" }, others),
    ).toEqual({
      email: "Another customer already uses this email: Harlow Property Group",
      phone: "Another customer already uses this phone number: Ben Okafor",
    });
    expect(contactWarnings({ name: "", email: "ben@example.com", phone: "" }, others)).toEqual({
      email: "Another customer already uses this email: Ben Okafor",
    });
  });
  test("ignores the customer being edited, and blanks", () => {
    expect(
      contactWarnings({ name: "", email: "ops@harlow.example", phone: "" }, others, "harlow"),
    ).toEqual({});
    expect(contactWarnings({ name: "", email: "", phone: "" }, others)).toEqual({});
  });
});

describe("findCustomers", () => {
  const customers = [
    { name: "Ben Okafor", phone: "360.555.0177" },
    { name: "Maria Delgado", phone: "+13605550118" },
    { name: "Ana Maria Ruiz", phone: "" },
    { name: "Harlow Property Group", phone: "+15035550100" },
  ];
  const names = (typed: string, limit?: number) =>
    findCustomers(customers, typed, limit).map((c) => c.name);

  test("finds by any part of the name, names starting with the typing first", () => {
    expect(names(" MARIA ")).toEqual(["Maria Delgado", "Ana Maria Ruiz"]);
    expect(names("okaf")).toEqual(["Ben Okafor"]);
  });

  test("finds by phone digits however they are typed or stored", () => {
    expect(names("(360) 555-0118")).toEqual(["Maria Delgado"]);
    expect(names("1 360 555 0177")).toEqual(["Ben Okafor"]);
    expect(names("555")).toEqual(["Ben Okafor", "Harlow Property Group", "Maria Delgado"]);
  });

  test("waits for three digits, and for any typing at all", () => {
    expect(names("36")).toEqual([]);
    expect(names("  ")).toEqual([]);
  });

  test("shows only the first few", () => {
    expect(names("a", 2)).toEqual(["Ana Maria Ruiz", "Ben Okafor"]);
  });
});
