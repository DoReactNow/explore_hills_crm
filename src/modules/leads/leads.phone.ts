// Phone numbers are stored in E.164 only (project_data.md 3.2). A number with no country code is
// read as Indian, the business's home country.
import { parsePhoneNumberFromString } from "libphonenumber-js";

const DEFAULT_COUNTRY = "IN";

export function normalisePhone(raw: string): string | null {
  if (/[a-zA-Z]/.test(raw)) return null;
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}
