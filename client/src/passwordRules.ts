// BR-10, mirrored from the server's rules (server/src/auth/password.ts). The
// server stays authoritative; this only lets the form show progress as the user
// types and stop an obviously invalid submission before it is sent.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export interface PasswordRule {
  id: "length" | "case" | "number" | "special";
  label: string;
  // Shown under the field when this is the first unmet rule.
  message: string;
  met: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN} characters`,
    message: `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    met: (p) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX,
  },
  {
    id: "case",
    label: "Upper and lower case letters",
    message: "Password must include an upper case and a lower case letter.",
    met: (p) => /[A-Z]/.test(p) && /[a-z]/.test(p),
  },
  { id: "number", label: "A number", message: "Password must include at least one number.", met: (p) => /[0-9]/.test(p) },
  {
    id: "special",
    label: "A special character",
    message: "Password must include at least one special character.",
    met: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

export function unmetRules(password: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !rule.met(password));
}
