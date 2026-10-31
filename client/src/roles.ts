import type { UserRole } from "./api.js";

// Where each role lands after signing in: its Dashboard (Lab 4 ui-spec section 3, FR-14).
export function landingPathFor(role: UserRole): string {
  return role === "REQUESTER" ? "/dashboard" : "/staff/dashboard";
}

export const ROLE_LABEL: Record<UserRole, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};
