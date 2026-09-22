"use client";
import { Input } from "./ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./ui/field";
import {
  formatPhone,
  normalizeEmail,
  MAX_CUSTOMER_FIELD,
  type CustomerErrors,
  type CustomerInput,
} from "@/lib/customer";

export const blankCustomer: CustomerInput = {
  name: "",
  site: "",
  email: "",
  phone: "",
};

/**
 * The four contact boxes, shared by every dialog that edits a customer. Values
 * self-correct as the owner types, so what is on screen is what gets stored.
 */
export function CustomerFields({
  value,
  onChange,
  errors = {},
  disabled,
}: {
  value: CustomerInput;
  onChange: (value: CustomerInput) => void;
  errors?: CustomerErrors;
  disabled?: boolean;
}) {
  const set = (key: keyof CustomerInput, next: string) =>
    onChange({ ...value, [key]: next });
  const text = (key: "name" | "site", label: string, placeholder: string) => (
    <Field data-invalid={Boolean(errors[key]) || undefined}>
      <FieldLabel htmlFor={key}>{label}</FieldLabel>
      <Input
        id={key}
        name={key}
        value={value[key]}
        placeholder={placeholder}
        maxLength={MAX_CUSTOMER_FIELD}
        disabled={disabled}
        aria-invalid={Boolean(errors[key])}
        onChange={(e) => set(key, e.target.value)}
      />
      <FieldError>{errors[key]}</FieldError>
    </Field>
  );
  return (
    <FieldGroup className="gap-4">
      {text("name", "Customer name", "Jane Doe")}
      {text("site", "Service address", "12 Oak Street, Springfield")}
      <Field data-invalid={Boolean(errors.email) || undefined}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value.email}
          placeholder="jane@example.com"
          maxLength={MAX_CUSTOMER_FIELD}
          disabled={disabled}
          aria-invalid={Boolean(errors.email)}
          onChange={(e) => set("email", e.target.value)}
          onBlur={(e) => set("email", normalizeEmail(e.target.value))}
        />
        <FieldError>{errors.email}</FieldError>
      </Field>
      <Field data-invalid={Boolean(errors.phone) || undefined}>
        <FieldLabel htmlFor="phone">Phone</FieldLabel>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value.phone}
          placeholder="(555) 123-4567"
          maxLength={MAX_CUSTOMER_FIELD}
          disabled={disabled}
          aria-invalid={Boolean(errors.phone)}
          onChange={(e) => set("phone", formatPhone(e.target.value))}
        />
        <FieldError>{errors.phone}</FieldError>
        <FieldDescription>
          Add an email or a phone number so you can send the signing link.
        </FieldDescription>
        <FieldError>{errors.contact}</FieldError>
      </Field>
    </FieldGroup>
  );
}
