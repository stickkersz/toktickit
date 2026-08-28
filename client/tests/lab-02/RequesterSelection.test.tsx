import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { Requester } from "../../src/api.js";

const STORAGE_KEY = "toktickit.currentRequesterId";

const ARI: Requester = { id: 1, name: "Ari Anan", email: "ari.anan@example.com" };
const BEN: Requester = { id: 2, name: "Ben Boon", email: "ben.boon@example.com" };

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Development Requester Selection", () => {
  it("shows a loading state while active Requesters are being fetched", async () => {
    let resolveFetch: (value: Requester[]) => void = () => {};
    vi.spyOn(api, "getRequesters").mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <MemoryRouter initialEntries={["/select-requester"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/loading requesters/i)).toBeInTheDocument();
    resolveFetch([ARI]);
    expect(await screen.findByLabelText(/development requester \*/i)).toBeInTheDocument();
  });

  it("shows a failure state with Retry when active Requesters fail to load", async () => {
    const spy = vi
      .spyOn(api, "getRequesters")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce([ARI]);

    render(
      <MemoryRouter initialEntries={["/select-requester"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/unable to load development requesters/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByLabelText(/development requester \*/i)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

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

  it("selecting a Requester and continuing persists only its id and reaches My Tickets", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI, BEN]);

    render(
      <MemoryRouter initialEntries={["/select-requester"]}>
        <App />
      </MemoryRouter>,
    );

    await userEvent.selectOptions(
      await screen.findByLabelText(/development requester \*/i),
      String(BEN.id),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/my tickets/i)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(BEN.id));
  });

  it("keeps a Requester signed in across reload when its stored id is still active", async () => {
    localStorage.setItem(STORAGE_KEY, String(ARI.id));
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);

    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/my tickets/i)).toBeInTheDocument();
  });

  // BR-05: an id left over from a since-removed or deactivated Requester must
  // not be trusted; it is revalidated on load and cleared if it no longer
  // resolves to an active Requester.
  it("clears an invalid stored Requester id and redirects to selection (BR-05)", async () => {
    localStorage.setItem(STORAGE_KEY, "999");
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);

    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/select development requester/i)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
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
