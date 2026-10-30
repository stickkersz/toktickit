import "@testing-library/jest-dom";
import { beforeEach, vi } from "vitest";
import * as api from "../src/api.js";

// Lab 4: both Ticket Details now load Actions Taken. Tests written before Lab 4 do not know about that
// request, so every test starts with an empty list instead of a real network call; a test that needs
// Actions overrides it.
beforeEach(() => {
  vi.spyOn(api, "getTicketActions").mockResolvedValue([]);
  vi.spyOn(api, "getTicketHistory").mockResolvedValue({ entries: [], earlierChangesUnrecorded: false });
});
