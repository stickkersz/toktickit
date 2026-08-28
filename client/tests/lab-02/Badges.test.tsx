import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriorityBadge, StatusBadge } from "../../src/Badge.js";

// STYLE-01: color class and text content together, never color alone.
describe("PriorityBadge", () => {
  it.each([
    ["LOW", "zg-badge-low", "Low"],
    ["MEDIUM", "zg-badge-medium", "Medium"],
    ["HIGH", "zg-badge-high", "High"],
  ] as const)("renders %s with its color class and text", (value, className, label) => {
    render(<PriorityBadge value={value} />);
    expect(screen.getByText(label)).toHaveClass(className);
  });
});

describe("StatusBadge", () => {
  it("renders NEW with its color class and text", () => {
    render(<StatusBadge value="NEW" />);
    expect(screen.getByText("New")).toHaveClass("zg-badge-new");
  });
});
