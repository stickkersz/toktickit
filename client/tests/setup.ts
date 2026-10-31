import "@testing-library/jest-dom";
import { afterEach, beforeEach, vi } from "vitest";
import * as api from "../src/api.js";

// Lab 4: both Ticket Details now load Actions Taken. Tests written before Lab 4 do not know about that
// request, so every test starts with an empty list instead of a real network call; a test that needs
// Actions overrides it.
beforeEach(() => {
  vi.spyOn(api, "getTicketActions").mockResolvedValue([]);
  vi.spyOn(api, "getTicketHistory").mockResolvedValue({ entries: [], earlierChangesUnrecorded: false });
  // Comments and notes load with every Ticket Detail too; without this a test that never looks at them
  // would reach for a real network and log the failure (UI-26).
  vi.spyOn(api, "getTicketComments").mockResolvedValue([]);
  vi.spyOn(api, "getTicketNotes").mockResolvedValue([]);
});

// UI-26 / BR-43, AC-44: a console error or warning fails the test that produced it. A test that expects
// one (a logged network failure) spies on the console itself, which replaces this collector.
let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ["error", "warn"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(`console.${level}: ${args.map(String).join(" ")}`);
    });
  }
});
afterEach(() => {
  if (logged.length > 0) throw new Error(`Console output during this test (BR-43):\n${logged.join("\n")}`);
});
