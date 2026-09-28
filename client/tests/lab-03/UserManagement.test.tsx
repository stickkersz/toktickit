import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, ValidationError, type AdminUser } from "../../src/api.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "./support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const user = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 20,
  name: "Wichai Charoen",
  email: "wichai.charoen@toktickit.test",
  role: "IT_STAFF",
  isActive: true,
  mustChangePassword: false,
  ...overrides,
});

const ME = user({ id: ADMIN.id, name: ADMIN.name, email: ADMIN.email, role: "ADMINISTRATOR" });
const OTHER_ADMIN = user({ id: 30, name: "Anucha Prasert", email: "anucha.prasert@toktickit.test", role: "ADMINISTRATOR" });
const ROWS = [ME, user(), OTHER_ADMIN, user({ id: 21, name: "Ploypailin Chaisiri", email: "ploypailin.chaisiri@toktickit.test", role: "REQUESTER", isActive: false })];

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

async function open(rows: AdminUser[] = ROWS) {
  renderApp("/admin/users", ADMIN);
  vi.mocked(api.getAdminUsers).mockResolvedValue(rows);
  await screen.findByRole("heading", { name: "User Management" });
  if (rows.length > 0) await screen.findByRole("table");
}
const table = () => screen.getByRole("table");
const rowOf = (name: string) => within(table()).getByRole("row", { name: new RegExp(name) });
const panel = () => screen.getByRole("region", { name: /(Create|Edit) User/ });
const edit = async (name: string) => userEvent.click(within(table()).getByRole("button", { name: `Edit ${name}` }));

describe("User Management: the list", () => {
  // UI-23 / FR-16
  it("lists each user with Name, Email, a Role badge, a Status badge and an Edit action, and never a delete", async () => {
    await open();
    const headers = within(table()).getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Name", "Email", "Role", "Status", "Actions"]);
    const wichai = rowOf("Wichai");
    expect(within(wichai).getByText("wichai.charoen@toktickit.test")).toBeInTheDocument();
    expect(within(wichai).getByText("IT Staff", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(wichai).getByText("Active", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(rowOf("Ploypailin")).getByText("Inactive", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(rowOf("Ploypailin")).getByText("Requester", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(rowOf("Anucha")).getByText("Administrator", { selector: ".zg-badge" })).toBeInTheDocument();
    for (const u of ROWS) expect(within(table()).getByRole("button", { name: `Edit ${u.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create User" })).toBeInTheDocument();
    expect(screen.queryByText(/pagination|next page|previous/i)).not.toBeInTheDocument();
  });

  it("asks for the name or email search and the role filter, and shows the rows it gets back", async () => {
    await open();
    const user_ = userEvent.setup();
    const get = vi.mocked(api.getAdminUsers);
    get.mockClear();
    get.mockResolvedValue([OTHER_ADMIN]);
    await user_.type(screen.getByRole("searchbox", { name: "Search users" }), "anucha");
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ search: "anucha", role: "" }));
    await waitFor(() => expect(within(table()).getAllByRole("row")).toHaveLength(2));
    await user_.selectOptions(screen.getByRole("combobox", { name: "Role" }), "Administrator");
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ search: "anucha", role: "ADMINISTRATOR" }));
    expect(screen.getByRole("searchbox", { name: "Search users" })).toHaveAttribute("placeholder", "Search users...");
    expect(within(screen.getByRole("combobox", { name: "Role" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["All roles", "Requester", "IT Staff", "Administrator"]);
  });

  it("says so when there are no users and when nothing matches, and keeps the search box on screen", async () => {
    renderApp("/admin/users", ADMIN);
    vi.mocked(api.getAdminUsers).mockResolvedValue([]);
    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "zzz");
    expect(await screen.findByText("No users match these filters.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search users" })).toHaveValue("zzz");
  });

  it("offers Retry when the list cannot be loaded, keeps the toolbar, and recovers", async () => {
    renderApp("/admin/users", ADMIN);
    vi.mocked(api.getAdminUsers).mockRejectedValueOnce(new ApiError("down", 500)).mockResolvedValue(ROWS);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the users.");
    expect(screen.getByRole("searchbox", { name: "Search users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create User" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("never lets a slower, older answer replace a newer one", async () => {
    renderApp("/admin/users", ADMIN);
    const first = deferred<AdminUser[]>();
    vi.mocked(api.getAdminUsers).mockReturnValueOnce(first.promise).mockResolvedValue([OTHER_ADMIN]);
    await screen.findByRole("searchbox", { name: "Search users" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "a");
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Anucha Prasert")).toBeInTheDocument());
    first.resolve(ROWS); // the older, unfiltered answer arrives last
    await new Promise((r) => setTimeout(r, 30));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByRole("table")).queryByText("Wichai Charoen")).not.toBeInTheDocument();
  });

  it("refuses a Requester and IT Staff who reach the route, showing no user data and asking for none", async () => {
    for (const who of [REQUESTER, STAFF]) {
      const { unmount } = renderApp("/admin/users", who);
      expect(await screen.findByText("You do not have access to User Management.")).toBeInTheDocument();
      expect(api.getAdminUsers).not.toHaveBeenCalled();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      unmount();
      vi.restoreAllMocks();
    }
  });
});

describe("User Management: creating a user", () => {
  async function fill(user_: ReturnType<typeof userEvent.setup>, o: { name?: string; email?: string; password?: string } = {}) {
    await user_.type(screen.getByLabelText("Full Name *"), o.name ?? "Alex Thompson");
    await user_.type(screen.getByLabelText("Email Address *"), o.email ?? "alex.thompson@toktickit.test");
    await user_.type(screen.getByLabelText("Initial Password *"), o.password ?? "Zen$Green7");
  }

  it("opens a panel with the fields the spec lists, moves focus to the first, and requires an initial password", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Create User" }));
    expect(within(panel()).getByRole("heading", { name: "Create User" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full Name *")).toHaveFocus();
    expect(screen.getByLabelText("Email Address *")).toBeInTheDocument();
    expect(within(panel()).getByRole("combobox", { name: "Role *" })).toHaveValue("REQUESTER");
    expect(within(panel()).getAllByRole("option").map((o) => o.textContent)).toEqual(["Requester", "IT Staff", "Administrator"]);
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
    expect(screen.getByLabelText("Initial Password *")).toBeInTheDocument();
    expect(screen.getByText("The user must change this password at their next login.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set new initial password" })).not.toBeInTheDocument();
  });

  it("lists the password rules as text and marks each one met or not met by words, not colour alone", async () => {
    await open();
    const user_ = userEvent.setup();
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    const rules = screen.getByRole("list", { name: "Password requirements" });
    expect(within(rules).getAllByRole("listitem")).toHaveLength(4);
    expect(within(rules).getAllByText(": not met")).toHaveLength(4);
    await user_.type(screen.getByLabelText("Initial Password *"), "Zen$Green7");
    expect(within(rules).getAllByText(": met")).toHaveLength(4);
  });

  it("sends the trimmed values, then closes the panel, says who was created, reloads the list and returns focus to Create User", async () => {
    await open();
    const user_ = userEvent.setup();
    const create = vi.spyOn(api, "createAdminUser").mockResolvedValue(user({ id: 99, name: "Alex Thompson", email: "alex.thompson@toktickit.test", role: "IT_STAFF", mustChangePassword: true }));
    vi.mocked(api.getAdminUsers).mockClear();
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    await fill(user_, { name: "  Alex Thompson  ", email: " Alex.Thompson@toktickit.test " });
    await user_.selectOptions(within(panel()).getByRole("combobox", { name: "Role *" }), "IT Staff");
    await user_.click(within(panel()).getByRole("button", { name: "Create User" }));

    expect(create).toHaveBeenCalledWith({ name: "Alex Thompson", email: "Alex.Thompson@toktickit.test", role: "IT_STAFF", isActive: true, initialPassword: "Zen$Green7" });
    await waitFor(() => expect(screen.queryByRole("region", { name: /Create User/ })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Created Alex Thompson.");
    await waitFor(() => expect(api.getAdminUsers).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Create User" })).toHaveFocus());
  });

  // UI-24 / AC-29
  it("shows a duplicate email as an inline error, and keeps the panel open with every value preserved", async () => {
    await open();
    const user_ = userEvent.setup();
    vi.spyOn(api, "createAdminUser").mockRejectedValue(new ApiError("taken", 409, "EMAIL_TAKEN"));
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    await fill(user_, { email: "wichai.charoen@toktickit.test" });
    await user_.selectOptions(within(panel()).getByRole("combobox", { name: "Role *" }), "Administrator");
    await user_.click(within(panel()).getByRole("button", { name: "Create User" }));

    const error = await screen.findByText("That email address is already in use.");
    expect(screen.getByLabelText("Email Address *")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email Address *")).toHaveAccessibleDescription("That email address is already in use.");
    expect(error).toHaveClass("zg-field-error");
    expect(panel()).toBeInTheDocument();
    expect(screen.getByLabelText("Full Name *")).toHaveValue("Alex Thompson");
    expect(screen.getByLabelText("Email Address *")).toHaveValue("wichai.charoen@toktickit.test");
    expect(screen.getByLabelText("Initial Password *")).toHaveValue("Zen$Green7");
    expect(within(panel()).getByRole("combobox", { name: "Role *" })).toHaveValue("ADMINISTRATOR");
    // Typing in the field clears the complaint.
    await user_.type(screen.getByLabelText("Email Address *"), "x");
    expect(screen.queryByText("That email address is already in use.")).not.toBeInTheDocument();
  });

  it("refuses an invalid form before sending anything, naming each field, and reports the server's per-field complaints", async () => {
    await open();
    const user_ = userEvent.setup();
    const create = vi.spyOn(api, "createAdminUser");
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    await user_.type(screen.getByLabelText("Full Name *"), "A");
    await user_.type(screen.getByLabelText("Email Address *"), "nope");
    await user_.type(screen.getByLabelText("Initial Password *"), "weak");
    await user_.click(within(panel()).getByRole("button", { name: "Create User" }));
    expect(screen.getByText("Name must be between 2 and 120 characters.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText(/Password must/, { selector: ".zg-field-error" })).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    // A complaint only the server makes is shown on its field too.
    await user_.clear(screen.getByLabelText("Full Name *"));
    await user_.clear(screen.getByLabelText("Email Address *"));
    await user_.clear(screen.getByLabelText("Initial Password *"));
    await fill(user_);
    create.mockRejectedValue(new ValidationError("bad", { name: "Name must be between 2 and 120 characters." }));
    await user_.click(within(panel()).getByRole("button", { name: "Create User" }));
    expect(await screen.findByText("Name must be between 2 and 120 characters.")).toBeInTheDocument();
  });

  it("says nothing was changed and keeps everything typed when the request fails outright, and sends once however often Create is pressed", async () => {
    await open();
    const user_ = userEvent.setup();
    const pending = deferred<AdminUser>();
    const create = vi.spyOn(api, "createAdminUser").mockReturnValueOnce(pending.promise);
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    await fill(user_);
    await user_.click(within(panel()).getByRole("button", { name: "Create User" }));
    expect(within(panel()).getByRole("button", { name: "Saving…" })).toBeDisabled();
    await user_.click(within(panel()).getByRole("button", { name: "Saving…" }));
    expect(create).toHaveBeenCalledTimes(1);
    pending.reject(new ApiError("down", 500));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save. Nothing was changed.");
    expect(screen.getByLabelText("Full Name *")).toHaveValue("Alex Thompson");
    expect(screen.getByLabelText("Initial Password *")).toHaveValue("Zen$Green7");
    expect(within(panel()).getByRole("button", { name: "Create User" })).toBeEnabled();
  });

  it("sends one request when the form is submitted twice in a row, whatever the button is doing", async () => {
    await open();
    const user_ = userEvent.setup();
    const pending = deferred<AdminUser>();
    const create = vi.spyOn(api, "createAdminUser").mockReturnValue(pending.promise);
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    await fill(user_);
    const form = screen.getByLabelText("Full Name *").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    pending.resolve(user({ id: 98, name: "Alex Thompson" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /Create User/ })).not.toBeInTheDocument());
  });

  it("closes without sending anything and returns focus to what opened it", async () => {
    await open();
    const user_ = userEvent.setup();
    const create = vi.spyOn(api, "createAdminUser");
    await user_.click(screen.getByRole("button", { name: "Create User" }));
    await user_.type(screen.getByLabelText("Full Name *"), "Someone");
    await user_.click(within(panel()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: /Create User/ })).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create User" })).toHaveFocus());
  });

  it("hides the list while the panel is open on a phone, by class, and shows it again on close", async () => {
    await open();
    const listColumn = () => screen.getByRole("search").parentElement!;
    expect(listColumn()).not.toHaveClass("d-none");
    await userEvent.click(screen.getByRole("button", { name: "Create User" }));
    expect(listColumn()).toHaveClass("d-none", "d-lg-block");
    await userEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
    expect(listColumn()).not.toHaveClass("d-none");
  });
});

describe("User Management: editing a user", () => {
  it("opens the user in the panel with focus on the name, the current values, and no way to type a password in the form itself", async () => {
    await open();
    await edit("Wichai Charoen");
    expect(within(panel()).getByRole("heading", { name: "Edit User" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full Name *")).toHaveFocus();
    expect(screen.getByLabelText("Full Name *")).toHaveValue("Wichai Charoen");
    expect(screen.getByLabelText("Email Address *")).toHaveValue("wichai.charoen@toktickit.test");
    expect(within(panel()).getByRole("combobox", { name: "Role *" })).toHaveValue("IT_STAFF");
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
    expect(screen.queryByLabelText("Initial Password *")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set new initial password" })).toBeInTheDocument();
  });

  it("keeps Save off until something changes, sends only what changed, and reloads the list", async () => {
    await open();
    const user_ = userEvent.setup();
    const update = vi.spyOn(api, "updateAdminUser").mockResolvedValue(user({ role: "ADMINISTRATOR", name: "Wichai C." }));
    await edit("Wichai Charoen");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user_.clear(screen.getByLabelText("Full Name *"));
    await user_.type(screen.getByLabelText("Full Name *"), " Wichai C. ");
    await user_.selectOptions(within(panel()).getByRole("combobox", { name: "Role *" }), "Administrator");
    vi.mocked(api.getAdminUsers).mockClear();
    await user_.click(screen.getByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledWith(20, { name: "Wichai C.", role: "ADMINISTRATOR" });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(api.getAdminUsers).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled(); // the new values are the baseline
  });

  it("treats an email that differs only in letter case as unchanged", async () => {
    await open();
    await edit("Wichai Charoen");
    await userEvent.type(screen.getByLabelText("Email Address *"), "{Control>}a{/Control}WICHAI.CHAROEN@TOKTICKIT.TEST");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("shows a duplicate email on an edit inline and keeps what was typed", async () => {
    await open();
    const user_ = userEvent.setup();
    vi.spyOn(api, "updateAdminUser").mockRejectedValue(new ApiError("taken", 409, "EMAIL_TAKEN"));
    await edit("Wichai Charoen");
    await user_.clear(screen.getByLabelText("Email Address *"));
    await user_.type(screen.getByLabelText("Email Address *"), "anucha.prasert@toktickit.test");
    await user_.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("That email address is already in use.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email Address *")).toHaveValue("anucha.prasert@toktickit.test");
  });

  it("notes that a user has not yet replaced their initial password", async () => {
    await open([user({ mustChangePassword: true })]);
    await edit("Wichai Charoen");
    expect(screen.getByText("This user has not yet replaced their initial password.")).toBeInTheDocument();
  });

  // UI-25 / AC-31
  it("disables the Active toggle on the Administrator's own row and says why in a tooltip and in words, and leaves it usable on everyone else's", async () => {
    await open();
    await edit(ADMIN.name);
    const toggle = screen.getByRole("switch", { name: "Active" });
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
    expect(toggle.closest("span")).toHaveAttribute("title", "You cannot deactivate your own account.");
    expect(toggle).toHaveAccessibleDescription("You cannot deactivate your own account.");
    expect(screen.getByText("You cannot deactivate your own account.", { selector: ".text-muted" })).toBeInTheDocument();

    await userEvent.click(within(panel()).getByRole("button", { name: "Close" }));
    await edit("Anucha Prasert");
    expect(screen.getByRole("switch", { name: "Active" })).toBeEnabled();
    expect(screen.queryByText("You cannot deactivate your own account.")).not.toBeInTheDocument();
  });

  it("explains a refused change to their own role, and puts the form back to what is stored", async () => {
    await open();
    const user_ = userEvent.setup();
    vi.spyOn(api, "updateAdminUser").mockRejectedValue(new ApiError("You cannot change your own role.", 409, "SELF_DEACTIVATION"));
    await edit(ADMIN.name);
    await user_.selectOptions(within(panel()).getByRole("combobox", { name: "Role *" }), "IT Staff");
    await user_.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot change your own role.");
    expect(within(panel()).getByRole("combobox", { name: "Role *" })).toHaveValue("ADMINISTRATOR");
  });

  // UI-26 / AC-32
  it("shows a clear callout when the last active Administrator would be lost, saves nothing, and leaves the row as it was", async () => {
    await open([ME, user()]);
    const user_ = userEvent.setup();
    vi.spyOn(api, "updateAdminUser").mockRejectedValue(new ApiError("At least one active Administrator is required.", 409, "LAST_ADMINISTRATOR"));
    await edit(ADMIN.name);
    await user_.selectOptions(within(panel()).getByRole("combobox", { name: "Role *" }), "Requester");
    await user_.click(screen.getByRole("button", { name: "Save changes" }));

    const callout = await screen.findByRole("alert");
    expect(callout).toHaveTextContent("At least one active Administrator is required.");
    expect(callout).toHaveClass("zg-alert-error");
    // The panel does not pretend anything was saved: the role is back, Saved is not shown.
    expect(within(panel()).getByRole("combobox", { name: "Role *" })).toHaveValue("ADMINISTRATOR");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    // And the list still shows the Administrator, with no reload asked for.
    expect(within(rowOf(ADMIN.name)).getByText("Administrator", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(rowOf(ADMIN.name)).getByText("Active", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(api.getAdminUsers).toHaveBeenCalledTimes(1);
  });

  it("shows the last-Administrator callout for another Administrator being deactivated too, and clears it on the next edit", async () => {
    await open();
    const user_ = userEvent.setup();
    vi.spyOn(api, "updateAdminUser").mockRejectedValue(new ApiError("x", 409, "LAST_ADMINISTRATOR"));
    await edit("Anucha Prasert");
    await user_.click(screen.getByRole("switch", { name: "Active" }));
    await user_.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At least one active Administrator is required.");
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
    await user_.type(screen.getByLabelText("Full Name *"), "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the user no longer exists when the server does", async () => {
    await open();
    vi.spyOn(api, "updateAdminUser").mockRejectedValue(new ApiError("gone", 404, "NOT_FOUND"));
    await edit("Wichai Charoen");
    await userEvent.type(screen.getByLabelText("Full Name *"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
  });
});

describe("User Management: a new initial password", () => {
  // UI-27 / AC-30
  it("sets it from a separate action and says the user must change it at their next login", async () => {
    await open();
    const user_ = userEvent.setup();
    const set = vi.spyOn(api, "setInitialPassword").mockResolvedValue(user({ mustChangePassword: true }));
    await edit("Wichai Charoen");
    await user_.click(screen.getByRole("button", { name: "Set new initial password" }));
    expect(screen.getByLabelText("New initial password *")).toHaveFocus();
    expect(screen.getByText(/The user must change this password at their next login\. Their current sessions end/)).toBeInTheDocument();
    await user_.type(screen.getByLabelText("New initial password *"), "Fresh#Start9");
    vi.mocked(api.getAdminUsers).mockClear();
    await user_.click(screen.getByRole("button", { name: "Set password" }));

    expect(set).toHaveBeenCalledWith(20, "Fresh#Start9");
    const done = await screen.findByText("Initial password set. Wichai Charoen must change it at their next sign in.");
    expect(done).toHaveAttribute("role", "status");
    expect(screen.queryByLabelText("New initial password *")).not.toBeInTheDocument(); // the password is not left on screen
    // ...nor remembered: opening the section again starts empty.
    await user_.click(screen.getByRole("button", { name: "Set new initial password" }));
    expect(screen.getByLabelText("New initial password *")).toHaveValue("");
    await user_.click(within(panel()).getAllByRole("button", { name: "Cancel" })[0]);
    await waitFor(() => expect(api.getAdminUsers).toHaveBeenCalled());
    expect(screen.getByText("This user has not yet replaced their initial password.")).toBeInTheDocument();
  });

  it("refuses a password that breaks the rules before sending it, and keeps the field when the request fails", async () => {
    await open();
    const user_ = userEvent.setup();
    const set = vi.spyOn(api, "setInitialPassword").mockRejectedValue(new ApiError("down", 500));
    await edit("Wichai Charoen");
    await user_.click(screen.getByRole("button", { name: "Set new initial password" }));
    await user_.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByText(/Password must/, { selector: ".zg-field-error" })).toBeInTheDocument();
    expect(set).not.toHaveBeenCalled();

    await user_.type(screen.getByLabelText("New initial password *"), "Fresh#Start9");
    await user_.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Unable to set the password. Nothing was changed.")).toBeInTheDocument();
    expect(screen.getByLabelText("New initial password *")).toHaveValue("Fresh#Start9");
    expect(screen.queryByText(/Initial password set/)).not.toBeInTheDocument();
  });

  it("can be cancelled, which forgets what was typed", async () => {
    await open();
    const user_ = userEvent.setup();
    await edit("Wichai Charoen");
    await user_.click(screen.getByRole("button", { name: "Set new initial password" }));
    await user_.type(screen.getByLabelText("New initial password *"), "Fresh#Start9");
    await user_.click(within(panel()).getAllByRole("button", { name: "Cancel" })[0]);
    await user_.click(screen.getByRole("button", { name: "Set new initial password" }));
    expect(screen.getByLabelText("New initial password *")).toHaveValue("");
  });

  it("is not offered on the Administrator's own row, which points to Change password instead", async () => {
    await open();
    await edit(ADMIN.name);
    expect(screen.queryByRole("button", { name: "Set new initial password" })).not.toBeInTheDocument();
    expect(screen.getByText(/Use Change password in the header/)).toBeInTheDocument();
  });
});
