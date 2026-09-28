import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, ValidationError } from "../../src/api.js";
import { REQUESTER, STAFF, TEMPORARY, renderApp } from "./support.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openChangePassword(current = TEMPORARY) {
  renderApp("/change-password", current);
  return {
    current: await screen.findByLabelText(/^Current .*password \*$/),
    next: screen.getByLabelText("New password *"),
    confirm: screen.getByLabelText("Confirm new password *"),
    submit: screen.getByRole("button", { name: "Continue" }),
  };
}

describe("Change Password screen", () => {
  // UI-06 / AC-02
  it("redirects a user with an initial password away from every other route, with no navigation rendered", async () => {
    for (const path of ["/tickets", "/tickets/new", "/select-requester", "/staff/tickets", "/login"]) {
      const { unmount } = renderApp(path, TEMPORARY);
      expect(await screen.findByRole("heading", { name: "Change Your Password" })).toBeInTheDocument();
      expect(screen.getByText("You must change your password to continue.")).toBeInTheDocument();
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /my tickets|create ticket/i })).not.toBeInTheDocument();
      // The identity and Logout are still offered.
      expect(screen.getByText(TEMPORARY.name)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("sends someone who is not signed in to Login instead", async () => {
    renderApp("/change-password", null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  // UI-07 / AC-07
  it("flips each rule to met live as the user types, and blocks submission while any is unmet", async () => {
    const change = vi.spyOn(api, "changePassword");
    const user = userEvent.setup();
    const { current, next, confirm, submit } = await openChangePassword();
    const list = screen.getByRole("list", { name: "Password requirements" });
    const state = (label: RegExp) => within(list).getByText(label).closest("li")!;

    for (const label of [/at least 8/i, /upper and lower/i, /a number/i, /special character/i]) {
      expect(state(label)).toHaveAttribute("data-met", "false");
      expect(state(label)).toHaveTextContent(/not met/);
    }

    await user.type(next, "abcdefgh");
    expect(state(/at least 8/i)).toHaveAttribute("data-met", "true");
    expect(state(/at least 8/i)).toHaveTextContent(/: met/);
    expect(state(/upper and lower/i)).toHaveAttribute("data-met", "false");

    await user.type(next, "A");
    expect(state(/upper and lower/i)).toHaveAttribute("data-met", "true");
    await user.type(next, "1");
    expect(state(/a number/i)).toHaveAttribute("data-met", "true");
    expect(state(/special character/i)).toHaveAttribute("data-met", "false");

    // One rule is still unmet, so submitting shows its message and sends nothing.
    await user.type(current, "ChangeMe!23");
    await user.type(confirm, "abcdefghA1");
    await user.click(submit);
    expect(await screen.findByText("Password must include at least one special character.")).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();

    await user.type(next, "!");
    expect(state(/special character/i)).toHaveAttribute("data-met", "true");
  });

  it("checks the length boundaries, a matching confirmation, and a new password that differs from the old one", async () => {
    const change = vi.spyOn(api, "changePassword");
    const user = userEvent.setup();
    const { current, next, confirm, submit } = await openChangePassword();

    await user.type(current, "ChangeMe!23");
    await user.type(next, "Aa1!aaa"); // 7 characters
    await user.type(confirm, "Aa1!aab");
    await user.click(submit);
    expect(await screen.findByText("Password must be between 8 and 128 characters.")).toBeInTheDocument();
    expect(screen.getByText("Password confirmation does not match.")).toBeInTheDocument();

    await user.clear(next);
    await user.type(next, "ChangeMe!23");
    await user.clear(confirm);
    await user.type(confirm, "ChangeMe!23");
    await user.click(submit);
    expect(await screen.findByText("New password must be different from the current password.")).toBeInTheDocument();

    await user.clear(next);
    await user.click(next);
    await user.paste("Aa1!" + "a".repeat(125)); // 129 characters
    await user.click(submit);
    expect(await screen.findByText("Password must be between 8 and 128 characters.")).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  // UI-08 / AC-08
  it("saves the new password, continues into the application, and the navigation appears", async () => {
    const change = vi.spyOn(api, "changePassword").mockResolvedValue(REQUESTER);
    const user = userEvent.setup();
    const { current, next, confirm, submit } = await openChangePassword();

    await user.type(current, "ChangeMe!23");
    await user.type(next, "Fresh!Pass456");
    await user.type(confirm, "Fresh!Pass456");
    await user.click(submit);

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(change).toHaveBeenCalledWith({
      currentPassword: "ChangeMe!23",
      newPassword: "Fresh!Pass456",
      confirmPassword: "Fresh!Pass456",
    });
    expect(screen.getByRole("link", { name: "Create Ticket" })).toBeInTheDocument();
    expect(screen.queryByText("You must change your password to continue.")).not.toBeInTheDocument();
  });

  it("continues to a staff user's own landing route after the change", async () => {
    vi.spyOn(api, "changePassword").mockResolvedValue(STAFF);
    const user = userEvent.setup();
    const { current, next, confirm, submit } = await openChangePassword({ ...STAFF, mustChangePassword: true });
    await user.type(current, "ChangeMe!23");
    await user.type(next, "Fresh!Pass456");
    await user.type(confirm, "Fresh!Pass456");
    await user.click(submit);
    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
  });

  it("puts a server field error and a wrong current password under the right fields", async () => {
    const change = vi
      .spyOn(api, "changePassword")
      .mockRejectedValueOnce(new ValidationError("Bad.", { newPassword: "Server says no." }))
      .mockRejectedValueOnce(new ApiError("Current password is incorrect.", 401, "INVALID_CREDENTIALS"));
    const user = userEvent.setup();
    const { current, next, confirm, submit } = await openChangePassword();
    await user.type(current, "ChangeMe!23");
    await user.type(next, "Fresh!Pass456");
    await user.type(confirm, "Fresh!Pass456");

    await user.click(submit);
    expect(await screen.findByText("Server says no.")).toBeInTheDocument();
    await user.click(submit);
    expect(await screen.findByText("Current password is incorrect.")).toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("keeps every entry and shows an error callout when the API is unreachable", async () => {
    vi.spyOn(api, "changePassword").mockRejectedValue(new ApiError("down", 0, "NETWORK_ERROR"));
    const user = userEvent.setup();
    const { current, next, confirm, submit } = await openChangePassword();
    await user.type(current, "ChangeMe!23");
    await user.type(next, "Fresh!Pass456");
    await user.type(confirm, "Fresh!Pass456");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to change the password right now/i);
    expect(current).toHaveValue("ChangeMe!23");
    expect(next).toHaveValue("Fresh!Pass456");
    expect(confirm).toHaveValue("Fresh!Pass456");
  });

  it("logs out from the Change Password screen and returns to Login", async () => {
    const logout = vi.spyOn(api, "logout").mockResolvedValue();
    const user = userEvent.setup();
    await openChangePassword();
    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("offers a show and hide toggle on each password field", async () => {
    const user = userEvent.setup();
    const { next } = await openChangePassword();
    expect(next).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show new password" }));
    expect(next).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Show current password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show password confirmation" })).toBeInTheDocument();
  });

  it("is voluntary for a user with no pending change and then has no mandatory subheading", async () => {
    await openChangePassword(REQUESTER);
    expect(screen.getByLabelText("Current password *")).toBeInTheDocument();
    expect(screen.queryByText("You must change your password to continue.")).not.toBeInTheDocument();
  });
});
