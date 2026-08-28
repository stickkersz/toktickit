import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Development Requester Selection", () => {
  // UI-14
  it("shows the empty state and keeps Continue disabled when no active Requesters exist", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/select-requester"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/no active development requesters are available/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  // UI-15
  it.each(["/tickets", "/tickets/new", "/tickets/42"])(
    "redirects %s to the Requester Selection screen when no Requester is selected",
    async (path) => {
      vi.spyOn(api, "getRequesters").mockResolvedValue([]);

      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );

      expect(await screen.findByText(/select development requester/i)).toBeInTheDocument();
    },
  );
});
