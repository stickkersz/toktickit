import type { UserRole } from "./api.js";

// Where each role lands after signing in (ui-spec §3). The staff and
// administrator screens arrive in later Lab 3 Issues; until then those routes
// render a placeholder.
export function landingPathFor(role: UserRole): string {
  switch (role) {
    case "IT_STAFF":
      return "/staff/tickets";
    case "ADMINISTRATOR":
      return "/admin/users";
    default:
      return "/tickets";
  }
}

export const ROLE_LABEL: Record<UserRole, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};
