import { z } from "zod";

// The owner types into four free-text boxes; everything below turns that typing
// into the one shape the customers table stores. Client and server share it, so
// a hand-written payload cannot slip past the rules the dialog enforces.
export const MAX_CUSTOMER_FIELD = 500;

/** The US digits in `input`, dropping a country code of 1 once one is implied. */
function usDigits(input: string) {
  const digits = input.replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

/** Progressive `(555) 123-4567` mask, safe to apply on every keystroke. */
export function formatPhone(input: string) {
  const digits = usDigits(input).slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A stored phone rendered for people. Rows saved before this validation kept
 * whatever the owner typed, so anything that is not E.164 is shown untouched.
 */
export function displayPhone(stored: string) {
  return /^\+1\d{10}$/.test(stored) ? formatPhone(stored.slice(2)) : stored;
}

export function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
}

/** `+15551234567`, `""` when blank, or null when it is not a US number. */
export function normalizePhone(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Only spacing and the punctuation a phone number is written with; letters or
  // an extension mean this is not a bare ten-digit number.
  if (!/^[\d\s().+-]+$/.test(trimmed)) return null;
  const digits = usDigits(trimmed);
  return digits.length === 10 ? `+1${digits}` : null;
}

const capped = z.string().max(MAX_CUSTOMER_FIELD, "Keep entries under 500 characters.");
const required = (label: string) =>
  capped.transform((value) => value.trim()).refine(Boolean, `Enter the ${label}.`);

export const customerSchema = z
  .object({
    name: required("customer name"),
    site: required("service address"),
    email: capped
      .transform(normalizeEmail)
      .refine(
        (email) => !email || z.email().safeParse(email).success,
        "Enter a valid email address.",
      ),
    phone: capped
      .transform(normalizePhone)
      .refine((phone) => phone !== null, "Enter a valid US phone number.")
      .transform((phone) => phone as string),
  })
  .refine((customer) => Boolean(customer.email || customer.phone), {
    error: "Add an email or phone number.",
    path: ["contact"],
  });

export type Customer = z.output<typeof customerSchema>;
export type CustomerInput = z.input<typeof customerSchema>;
/** Field name to message, including the cross-field `contact` rule. */
export type CustomerErrors = Partial<Record<keyof Customer | "contact", string>>;

export function customerErrors(error: z.ZodError): CustomerErrors {
  const errors: CustomerErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "contact") as keyof CustomerErrors;
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Throws the first field-naming message, for callers with no field to blame. */
export function parseCustomer(input: CustomerInput): Customer {
  const result = customerSchema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}
