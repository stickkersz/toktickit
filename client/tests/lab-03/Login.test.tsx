import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError } from "../../src/api.js";
import { REQUESTER, STAFF, renderApp } from "./support.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openLogin() {
  renderApp("/login");
  return {
    email: await screen.findByLabelText("Email address *"),
    password: screen.getByLabelText("Password *"),
    submit: screen.getByRole("button", { name: "Sign In" }),
  };
}

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  const fields = await openLogin();
  if (email) await user.type(fields.email, email);
  if (password) await user.type(fields.password, password);
  return { user, ...fields };
}

describe("Login screen", () => {
  // UI-01 / AC-01
  it("signs in once, stores nothing in localStorage, and lands a Requester on My Tickets", async () => {
    const login = vi.spyOn(api, "login").mockResolvedValue(REQUESTER);
    const { user, submit } = await fill(REQUESTER.email, "Str0ng!Pass");
    await user.click(submit);

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(REQUESTER.email, "Str0ng!Pass");
    expect(localStorage.length).toBe(0);
    expect(screen.getByText(REQUESTER.name)).toBeInTheDocument();
  });

  it("lands IT Staff on their own landing route instead of the Requester screens", async () => {
    vi.spyOn(api, "login").mockResolvedValue(STAFF);
    const { user, submit } = await fill(STAFF.email, "Str0ng!Pass");
    await user.click(submit);

    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
  });

  it("sends a user who signs in with an initial password straight to Change Password", async () => {
    vi.spyOn(api, "login").mockResolvedValue({ ...REQUESTER, mustChangePassword: true });
    const { user, submit } = await fill(REQUESTER.email, "ChangeMe!23");
    await user.click(submit);
    expect(await screen.findByRole("heading", { name: "Change Your Password" })).toBeInTheDocument();
  });

  // UI-02 / FR-01
  it("shows a per-field message for a missing email, a malformed email, and a missing password, with no API call", async () => {
    const login = vi.spyOn(api, "login");
    const user = userEvent.setup();
    const { email, password, submit } = await openLogin();

    await user.click(submit);
    expect(await screen.findByText("Email address is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();

    await user.type(email, "not-an-email");
    await user.tab();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");

    await user.click(submit);
    expect(login).not.toHaveBeenCalled();
  });

  // UI-03 / AC-06
  it("shows the generic credential callout, keeps the email, and clears the password", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new ApiError("Invalid email or password.", 401, "INVALID_CREDENTIALS"));
    const { user, submit, email, password } = await fill("someone@toktickit.test", "Wrong!Pass123");
    await user.click(submit);

    const callout = await screen.findByRole("alert");
    expect(callout).toHaveTextContent("Invalid email or password. Please try again.");
    expect(callout).toHaveClass("zg-alert-error");
    expect(email).toHaveValue("someone@toktickit.test");
    expect(password).toHaveValue("");
    expect(password).toHaveFocus();
    expect(screen.queryByText(/inactive/i)).not.toBeInTheDocument();
  });

  // UI-04 / AC-05
  it("shows a distinct, differently styled callout for an inactive account", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new ApiError("This account is inactive.", 401, "ACCOUNT_INACTIVE"));
    const { user, submit } = await fill("gone@toktickit.test", "Str0ng!Pass");
    await user.click(submit);

    const callout = await screen.findByRole("alert");
    expect(callout).toHaveTextContent("This account is inactive. Contact an administrator.");
    expect(callout).toHaveClass("zg-alert-warning");
    expect(callout).not.toHaveClass("zg-alert-error");
    expect(screen.queryByText(/invalid email or password/i)).not.toBeInTheDocument();
  });

  it("shows a separate API-failure callout with Retry that resends the kept values", async () => {
    const login = vi
      .spyOn(api, "login")
      .mockRejectedValueOnce(new ApiError("Unable to reach the TokTickIT API.", 0, "NETWORK_ERROR"))
      .mockResolvedValueOnce(REQUESTER);
    const { user, submit, password } = await fill(REQUESTER.email, "Str0ng!Pass");
    await user.click(submit);

    expect(await screen.findByText("Unable to sign in right now. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/invalid email or password/i)).not.toBeInTheDocument();
    expect(password).toHaveValue("Str0ng!Pass");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(2);
  });

  // UI-05 / FR-01
  it("disables Sign In and issues exactly one request when double submitted", async () => {
    let resolveLogin: (u: typeof REQUESTER) => void = () => {};
    const login = vi.spyOn(api, "login").mockReturnValue(new Promise((resolve) => (resolveLogin = resolve)));
    const { user, submit } = await fill(REQUESTER.email, "Str0ng!Pass");

    await user.dblClick(submit);
    const busy = await screen.findByRole("button", { name: /signing in/i });
    expect(busy).toBeDisabled();
    expect(login).toHaveBeenCalledTimes(1);

    resolveLogin(REQUESTER);
    await waitFor(() => expect(screen.getByRole("heading", { name: "My Tickets" })).toBeInTheDocument());
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("offers a labelled show and hide toggle for the password and no Forgot password link", async () => {
    const user = userEvent.setup();
    const { password } = await openLogin();
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("title", "Hide password");
    expect(screen.getByLabelText("Password *")).toBe(password);
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
  });

  it("does not render the login form to someone who is already signed in", async () => {
    renderApp("/login", REQUESTER);
    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address *")).not.toBeInTheDocument();
  });
});
