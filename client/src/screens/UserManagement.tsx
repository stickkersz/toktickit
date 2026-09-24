import { useEffect, useRef, useState } from "react";
import {
  AdminUser,
  ApiError,
  UserRole,
  ValidationError,
  createAdminUser,
  getAdminUsers,
  setInitialPassword,
  updateAdminUser,
} from "../api.js";
import { useAuth } from "../authContext.js";
import { RoleBadge, UserStatusBadge } from "../Badge.js";
import PasswordField from "../PasswordField.js";
import { PASSWORD_RULES, unmetRules } from "../passwordRules.js";
import { ROLE_LABEL } from "../roles.js";

type ListState = "loading" | "ready" | "error";
type Panel = { mode: "create" } | { mode: "edit"; user: AdminUser };

const ROLES: UserRole[] = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"];
const EMAIL_TAKEN = "That email address is already in use.";
const LAST_ADMIN = "At least one active Administrator is required.";
const OWN_ACCOUNT = "You cannot deactivate your own account.";
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// ui-spec.md section 9: Administrator User Management. A two-pane layout on a wide screen, the list on
// the left and a create or edit panel on the right. On a phone the panel takes over the width and the
// list is hidden while it is open. No screen offers a delete: users are never deleted (BR-44).
export default function UserManagement() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [listState, setListState] = useState<ListState>("loading");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Rapid typing fires overlapping requests: only the newest may write to the screen (a Lab 2 defect).
  const requestIdRef = useRef(0);
  function load() {
    const requestId = ++requestIdRef.current;
    setListState("loading");
    getAdminUsers({ search: search.trim() || undefined, role })
      .then((list) => {
        if (requestIdRef.current !== requestId) return;
        setUsers(list);
        setListState("ready");
        setHasLoadedOnce(true);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setUsers([]);
        setListState("error");
      });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [search, role]);

  // ui-spec.md section 12: opening the panel moves focus into it, closing it returns focus to what opened it.
  function open(next: Panel, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setNotice(null);
    setPanel(next);
  }
  function close() {
    setPanel(null);
    const trigger = triggerRef.current;
    // After the list has re-rendered, an Edit button may be a new element: find it again by its id.
    setTimeout(() => {
      const target = trigger && document.body.contains(trigger) ? trigger : trigger?.id ? document.getElementById(trigger.id) : null;
      target?.focus();
    }, 0);
  }

  const anyFilter = Boolean(search.trim() || role);

  return (
    <div className="py-2">
      <h1 className="h4 mb-3">User Management</h1>
      <div className="row g-4">
        <div className={`col-12 col-lg-7${panel ? " d-none d-lg-block" : ""}`}>
          <div className="row g-2 mb-3" role="search">
            <div className="col-12 col-md-5">
              <input
                type="search"
                className="form-control"
                aria-label="Search users"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="col-7 col-md-4">
              <select className="form-select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as UserRole | "")}>
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-5 col-md-3 d-grid">
              <button id="create-user" type="button" className="btn zg-btn-primary zg-touch-target" onClick={(e) => open({ mode: "create" }, e.currentTarget)}>
                Create User
              </button>
            </div>
          </div>

          {notice && (
            <div className="zg-banner-pale rounded p-2 mb-3 small" role="status">
              {notice}
            </div>
          )}

          {listState === "error" && (
            <div className="zg-alert-error rounded p-3" role="alert">
              <p className="mb-2">Unable to load the users.</p>
              <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
                Retry
              </button>
            </div>
          )}

          {listState === "loading" && (
            <p role="status" className="text-muted small mb-2">
              Loading…
            </p>
          )}

          {listState === "ready" && users.length === 0 && (
            <p className="text-muted py-4 text-center">{anyFilter ? "No users match these filters." : "No users yet."}</p>
          )}

          {/* Kept on screen while a newer request is in flight, so a typist keeps their place. */}
          {listState !== "error" && users.length > 0 && hasLoadedOnce && (
            <div aria-busy={listState === "loading"}>
              <div className="d-none d-md-block table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td className="text-break">{u.email}</td>
                        <td>
                          <RoleBadge role={u.role} />
                        </td>
                        <td>
                          <UserStatusBadge isActive={u.isActive} />
                        </td>
                        <td className="text-end">
                          <button
                            id={`edit-user-${u.id}`}
                            type="button"
                            className="btn btn-outline-secondary btn-sm zg-touch-target"
                            aria-label={`Edit ${u.name}`}
                            onClick={(e) => open({ mode: "edit", user: u }, e.currentTarget)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list-unstyled d-md-none" aria-label="Users">
                {users.map((u) => (
                  <li key={u.id} className="zg-user-card">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div>
                        <div className="fw-semibold">{u.name}</div>
                        <div className="small text-break">{u.email}</div>
                        <div className="d-flex flex-wrap gap-2 mt-1">
                          <RoleBadge role={u.role} />
                          <UserStatusBadge isActive={u.isActive} />
                        </div>
                      </div>
                      <button
                        id={`edit-user-card-${u.id}`}
                        type="button"
                        className="btn btn-outline-secondary btn-sm zg-touch-target"
                        aria-label={`Edit ${u.name}`}
                        onClick={(e) => open({ mode: "edit", user: u }, e.currentTarget)}
                      >
                        Edit
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {panel && (
          <div className="col-12 col-lg-5">
            <UserPanel
              key={panel.mode === "edit" ? `edit-${panel.user.id}` : "create"}
              panel={panel}
              onClose={close}
              onCreated={(u) => {
                setNotice(`Created ${u.name}.`);
                close();
                load();
              }}
              onChanged={load}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface Form {
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  initialPassword: string;
}

const fromUser = (u: AdminUser): Form => ({ name: u.name, email: u.email, role: u.role, isActive: u.isActive, initialPassword: "" });

function UserPanel({ panel, onClose, onCreated, onChanged }: { panel: Panel; onClose: () => void; onCreated: (u: AdminUser) => void; onChanged: () => void }) {
  const { user: me } = useAuth();
  const creating = panel.mode === "create";
  const [base, setBase] = useState<AdminUser | null>(panel.mode === "edit" ? panel.user : null);
  const [form, setForm] = useState<Form>(base ? fromUser(base) : { name: "", email: "", role: "REQUESTER", isActive: true, initialPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [callout, setCallout] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Set a new initial password for an existing user: a separate action (ui-spec.md section 9).
  const [settingPassword, setSettingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordDone, setPasswordDone] = useState<string | null>(null);

  useEffect(() => nameRef.current?.focus(), []);

  const isSelf = base !== null && me?.id === base.id;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
    setCallout(null);
    setSaved(null);
  };

  const changes = base
    ? {
        ...(form.name.trim() !== base.name ? { name: form.name.trim() } : {}),
        ...(form.email.trim().toLowerCase() !== base.email ? { email: form.email.trim() } : {}),
        ...(form.role !== base.role ? { role: form.role } : {}),
        ...(form.isActive !== base.isActive ? { isActive: form.isActive } : {}),
      }
    : {};
  const dirty = creating || Object.keys(changes).length > 0;

  function check(f: Form, includePassword: boolean): Record<string, string> {
    const found: Record<string, string> = {};
    const name = f.name.trim();
    if (name.length < 2 || name.length > 120) found.name = "Name must be between 2 and 120 characters.";
    const address = f.email.trim();
    if (address.length > 254 || !EMAIL_SHAPE.test(address)) found.email = "Enter a valid email address.";
    if (includePassword) {
      const [first] = unmetRules(f.initialPassword);
      if (first) found.initialPassword = first.message;
    }
    return found;
  }

  function explain(e: unknown) {
    if (e instanceof ValidationError) {
      setErrors(e.fields);
    } else if (e instanceof ApiError && e.code === "EMAIL_TAKEN") {
      setErrors({ email: EMAIL_TAKEN });
    } else if (e instanceof ApiError && e.code === "LAST_ADMINISTRATOR") {
      setCallout(LAST_ADMIN);
      // Nothing was saved, so the form goes back to what is stored rather than showing a state that is not real.
      if (base) setForm((f) => ({ ...f, role: base.role, isActive: base.isActive }));
    } else if (e instanceof ApiError && e.code === "SELF_DEACTIVATION") {
      setCallout(e.message);
      if (base) setForm((f) => ({ ...f, role: base.role, isActive: base.isActive }));
    } else if (e instanceof ApiError && e.status === 404) {
      setCallout("This user no longer exists. Close this panel and reload the list.");
    } else {
      setCallout("Unable to save. Nothing was changed.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = check(form, creating);
    setErrors(found);
    setCallout(null);
    setSaved(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (creating) {
        onCreated(
          await createAdminUser({
            name: form.name.trim(),
            email: form.email.trim(),
            role: form.role,
            isActive: form.isActive,
            initialPassword: form.initialPassword,
          }),
        );
        return;
      }
      const updated = await updateAdminUser(base!.id, changes);
      setBase(updated);
      setForm(fromUser(updated));
      setSaved("Saved.");
      onChanged();
    } catch (e) {
      explain(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword() {
    if (passwordBusy || !base) return;
    const [first] = unmetRules(newPassword);
    if (first) {
      setPasswordError(first.message);
      return;
    }
    setPasswordBusy(true);
    setPasswordError(null);
    try {
      const updated = await setInitialPassword(base.id, newPassword);
      setBase(updated);
      setNewPassword("");
      setSettingPassword(false);
      setPasswordDone(`Initial password set. ${updated.name} must change it at their next sign in.`);
      onChanged();
    } catch (e) {
      setPasswordError(e instanceof ValidationError ? (e.fields.initialPassword ?? e.message) : "Unable to set the password. Nothing was changed.");
    } finally {
      setPasswordBusy(false);
    }
  }

  const rules = (value: string, id: string) => (
    <ul id={id} className="list-unstyled small mb-2" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.met(value);
        return (
          <li key={rule.id} className={met ? "zg-rule-met" : "zg-rule-unmet"} data-met={met}>
            <span aria-hidden="true">{met ? "✓" : "○"} </span>
            {rule.label}
            <span className="visually-hidden">{met ? ": met" : ": not met"}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="zg-user-panel" aria-labelledby="user-panel-heading">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 id="user-panel-heading" className="h5 mb-0">
          {creating ? "Create User" : "Edit User"}
        </h2>
        <button type="button" className="btn btn-outline-secondary btn-sm zg-touch-target" onClick={onClose}>
          {creating ? "Cancel" : "Close"}
        </button>
      </div>

      {callout && (
        <div className="zg-alert-error rounded p-3 mb-3" role="alert">
          {callout}
        </div>
      )}

      <form noValidate onSubmit={submit}>
        <div className="mb-1">
          <label htmlFor="um-name" className="form-label fw-semibold">
            Full Name *
          </label>
          <input
            id="um-name"
            ref={nameRef}
            className={`form-control zg-editable${errors.name ? " is-invalid" : ""}`}
            value={form.name}
            maxLength={200}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "um-name-error" : undefined}
            onChange={(e) => set("name", e.target.value)}
          />
          <div className="zg-field-feedback small">{errors.name && <div id="um-name-error" className="zg-field-error">{errors.name}</div>}</div>
        </div>

        <div className="mb-1">
          <label htmlFor="um-email" className="form-label fw-semibold">
            Email Address *
          </label>
          <input
            id="um-email"
            type="email"
            className={`form-control zg-editable${errors.email ? " is-invalid" : ""}`}
            value={form.email}
            maxLength={300}
            autoComplete="off"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "um-email-error" : undefined}
            onChange={(e) => set("email", e.target.value)}
          />
          <div className="zg-field-feedback small">{errors.email && <div id="um-email-error" className="zg-field-error">{errors.email}</div>}</div>
        </div>

        <div className="mb-3">
          <label htmlFor="um-role" className="form-label fw-semibold">
            Role *
          </label>
          <select id="um-role" className="form-select zg-editable" value={form.role} onChange={(e) => set("role", e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          {/* A disabled control shows no tooltip in a browser, so the reason is on the wrapper as a
              title and also written out under the toggle, where a phone user can read it. */}
          <span title={isSelf ? OWN_ACCOUNT : undefined}>
            <div className="form-check form-switch">
              <input
                id="um-active"
                type="checkbox"
                role="switch"
                className="form-check-input"
                checked={form.isActive}
                disabled={isSelf}
                aria-describedby={isSelf ? "um-active-why" : undefined}
                onChange={(e) => set("isActive", e.target.checked)}
              />
              <label htmlFor="um-active" className="form-check-label fw-semibold">
                Active
              </label>
            </div>
          </span>
          {isSelf && (
            <div id="um-active-why" className="small text-muted">
              {OWN_ACCOUNT}
            </div>
          )}
        </div>

        {creating && (
          <div className="mb-3">
            <h3 className="h6">Initial Password</h3>
            <PasswordField
              id="um-password"
              label="Initial Password *"
              noun="initial password"
              value={form.initialPassword}
              onChange={(v) => set("initialPassword", v)}
              error={errors.initialPassword}
              autoComplete="new-password"
              describedBy="um-password-rules"
            />
            {rules(form.initialPassword, "um-password-rules")}
            <p className="small text-muted mb-0">The user must change this password at their next login.</p>
          </div>
        )}

        {!creating && base?.mustChangePassword && (
          <p className="small text-muted">This user has not yet replaced their initial password.</p>
        )}

        {saved && (
          <p className="text-success small mb-2" role="status">
            {saved}
          </p>
        )}

        <div className="d-flex gap-2 justify-content-end">
          <button type="submit" className="btn zg-btn-primary zg-touch-target" disabled={busy || !dirty}>
            {busy ? "Saving…" : creating ? "Create User" : "Save changes"}
          </button>
        </div>
      </form>

      {!creating && base && (
        <div className="mt-4 pt-3 border-top">
          <h3 className="h6">Initial Password</h3>
          {passwordDone && (
            <p className="text-success small" role="status">
              {passwordDone}
            </p>
          )}
          {isSelf ? (
            <p className="small text-muted mb-0">Use Change password in the header to change your own password.</p>
          ) : !settingPassword ? (
            <>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm zg-touch-target"
                onClick={() => {
                  setSettingPassword(true);
                  setPasswordDone(null);
                }}
              >
                Set new initial password
              </button>
              <p className="small text-muted mt-2 mb-0">The user must change this password at their next login.</p>
            </>
          ) : (
            <div>
              <PasswordField
                id="um-new-password"
                label="New initial password *"
                noun="new initial password"
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v);
                  setPasswordError(null);
                }}
                error={passwordError ?? undefined}
                autoComplete="new-password"
                describedBy="um-new-password-rules"
                autoFocus
              />
              {rules(newPassword, "um-new-password-rules")}
              <p className="small text-muted">The user must change this password at their next login. Their current sessions end when you set it.</p>
              <div className="d-flex gap-2 justify-content-end">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm zg-touch-target"
                  disabled={passwordBusy}
                  onClick={() => {
                    setSettingPassword(false);
                    setNewPassword("");
                    setPasswordError(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn zg-btn-primary btn-sm zg-touch-target" disabled={passwordBusy} onClick={() => void submitPassword()}>
                  {passwordBusy ? "Setting…" : "Set password"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
