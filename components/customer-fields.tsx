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

const BOXES: {
  key: keyof CustomerInput;
  label: string;
  placeholder: string;
  props?: React.ComponentProps<typeof Input>;
  /** Applied on every keystroke, so the box always shows what will be stored. */
  onType?: (typed: string) => string;
  /** Applied when the owner leaves the box, for tidying too rude to do mid-word. */
  onLeave?: (typed: string) => string;
}[] = [
  { key: "name", label: "Customer name", placeholder: "Jane Doe" },
  {
    key: "site",
    label: "Service address",
    placeholder: "12 Oak Street, Springfield",
  },
  {
    key: "email",
    label: "Email",
    placeholder: "jane@example.com",
    props: { type: "email", inputMode: "email", autoComplete: "email" },
    onLeave: normalizeEmail,
  },
  {
    key: "phone",
    label: "Phone",
    placeholder: "(555) 123-4567",
    props: { type: "tel", inputMode: "tel", autoComplete: "tel" },
    onType: formatPhone,
  },
];

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
  return (
    <FieldGroup className="gap-4">
      {BOXES.map(({ key, label, placeholder, props, onType, onLeave }) => {
        const set = (next: string) => onChange({ ...value, [key]: next });
        return (
          <Field key={key} data-invalid={Boolean(errors[key]) || undefined}>
            <FieldLabel htmlFor={key}>{label}</FieldLabel>
            <Input
              id={key}
              name={key}
              value={value[key]}
              placeholder={placeholder}
              maxLength={MAX_CUSTOMER_FIELD}
              disabled={disabled}
              aria-invalid={Boolean(errors[key])}
              onChange={(e) => set(onType ? onType(e.target.value) : e.target.value)}
              onBlur={onLeave && ((e) => set(onLeave(e.target.value)))}
              {...props}
            />
            <FieldError>{errors[key]}</FieldError>
          </Field>
        );
      })}
      {/* Belongs to the email and phone pair above, not to either box alone. */}
      <FieldDescription>
        Add an email or a phone number so you can send the signing link.
      </FieldDescription>
      <FieldError>{errors.contact}</FieldError>
    </FieldGroup>
  );
}
