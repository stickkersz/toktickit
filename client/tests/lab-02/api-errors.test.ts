import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError, createTicket } from "../../src/api.js";

// UI-17: Create Ticket is the only screen that renders a thrown error's own
// message to the Requester, so createTicket must never let a raw browser or
// non-JSON failure reach the interface. The Playwright evidence test only
// asserts that an alert appears; these assert the actual text.
const INPUT = {
  requesterId: 1,
  categoryId: 1,
  relatedSystemId: 1,
  summary: "Projector will not power on",
  description: "The projector shows no power light and swapping the cable changed nothing.",
  requestedPriority: "HIGH" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createTicket error messages", () => {
  it("replaces a network-level failure with a readable message", async () => {
    // What fetch actually throws when the API is unreachable.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createTicket(INPUT)).rejects.toThrow(
      "Unable to reach the TokTickIT API. Check your connection and try again.",
    );
    await expect(createTicket(INPUT)).rejects.not.toThrow(/failed to fetch/i);
  });

  it("keeps the technical detail in the console rather than the message", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createTicket(INPUT)).rejects.toThrow(/unable to reach/i);
    expect(consoleError).toHaveBeenCalledWith(
      "createTicket: request did not reach the API",
      cause,
    );
  });

  it("replaces a non-JSON response body with a readable message", async () => {
    // Reachable in practice: a multer-level upload failure returns Express's
    // default HTML error page, not the documented error envelope.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createTicket(INPUT)).rejects.toThrow(
      "The server returned an unexpected response. Please try again.",
    );
  });

  it("still surfaces a documented VALIDATION_ERROR with its per-field messages", async () => {
    // The new guards must not swallow the 400 envelope BR-18 depends on.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: "VALIDATION_ERROR",
            message: "Summary must be between 5 and 120 characters.",
            fields: { summary: "Summary must be between 5 and 120 characters." },
          }),
      }),
    );

    await expect(createTicket(INPUT)).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(INPUT)).rejects.toMatchObject({
      fields: { summary: "Summary must be between 5 and 120 characters." },
    });
  });

  it("still surfaces a documented non-validation error message from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "INTERNAL_ERROR", message: "Unable to create the Ticket." }),
      }),
    );

    await expect(createTicket(INPUT)).rejects.toThrow("Unable to create the Ticket.");
  });
});
