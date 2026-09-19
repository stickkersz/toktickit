import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoleBadge, StatusBadge } from "../../src/Badge.js";

// ui-spec.md section 2: every status carries its full text label and its own style,
// so colour is never the only signal, and a Requester and an IT Staff member reading
// the same Ticket see the same wording.
describe("StatusBadge for all eight statuses", () => {
  it.each([
    ["NEW", "New", "zg-badge-new"],
    ["OPEN", "Open", "zg-badge-open"],
    ["IN_PROGRESS", "In Progress", "zg-badge-in-progress"],
    ["WAITING_FOR_REQUESTER", "Waiting for Requester", "zg-badge-waiting"],
    ["RESOLVED", "Resolved", "zg-badge-resolved"],
    ["CLOSED", "Closed", "zg-badge-closed"],
    ["REOPENED", "Reopened", "zg-badge-reopened"],
    ["CANCELLED", "Cancelled", "zg-badge-cancelled"],
  ])("renders %s as %s with its own style", (value, label, className) => {
    render(<StatusBadge value={value} />);
    expect(screen.getByText(label)).toHaveClass("zg-badge", className);
  });

  it("gives every status a distinct style, so no two share a look", () => {
    const classes = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"].map(
      (status) => {
        const { container, unmount } = render(<StatusBadge value={status} />);
        const cls = container.firstElementChild!.className;
        unmount();
        return cls;
      },
    );
    expect(new Set(classes).size).toBe(8);
  });

  it("falls back to the raw text on the neutral style for an unknown value", () => {
    render(<StatusBadge value="SOMETHING_NEW" />);
    expect(screen.getByText("SOMETHING_NEW")).toHaveClass("zg-badge", "zg-badge-low");
  });
});

describe("RoleBadge", () => {
  it.each([
    ["REQUESTER", "Requester"],
    ["IT_STAFF", "IT Staff"],
    ["ADMINISTRATOR", "Administrator"],
  ] as const)("renders %s as %s in the neutral outline", (role, label) => {
    render(<RoleBadge role={role} />);
    expect(screen.getByText(label)).toHaveClass("zg-badge", "zg-badge-role");
  });
});
