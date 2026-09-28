import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, ValidationError, changePassword } from "../api.js";
import { useAuth } from "../authContext.js";
import PasswordField from "../PasswordField.js";
import { PASSWORD_RULES, unmetRules } from "../passwordRules.js";
import { landingPathFor, ROLE_LABEL } from "../roles.js";

type Fields = { currentPassword?: string; newPassword?: string; confirmPassword?: string };

// ui-spec §5. While the change is mandatory the shell offers the user's identity
// and Logout but no navigation, and every other route redirects here.
export default function ChangePassword() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Fields>({});
  const [apiFailure, setApiFailure] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null; // RequireAuth redirects before this renders.
  const mandatory = user.mustChangePassword;

  function validate(): Fields {
    const found: Fields = {};
    if (currentPassword === "") found.currentPassword = "Current password is required.";
    const [firstUnmet] = unmetRules(newPassword);
    if (firstUnmet) found.newPassword = firstUnmet.message;
    else if (newPassword === currentPassword) found.newPassword = "New password must be different from the current password.";
    if (confirmPassword !== newPassword) found.confirmPassword = "Password confirmation does not match.";
    return found;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = validate();
    setErrors(found);
    setApiFailure(false);
    // The server would refuse this too; no request is made for a form that is
    // already known to be invalid.
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const updated = await changePassword({ currentPassword, newPassword, confirmPassword });
      signIn(updated);
      navigate(landingPathFor(updated.role), { replace: true });
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors(e.fields);
      } else if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS") {
        setErrors({ currentPassword: "Current password is incorrect." });
      } else {
        // Every value stays in the form so nothing has to be retyped.
        setApiFailure(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div>
      <header className="zg-header px-3 py-2 d-flex align-items-center justify-content-between gap-2">
        <span className="text-white fw-semibold">TokTickIT</span>
        <div className="d-flex align-items-center gap-2 gap-md-3">
          <span className="text-white">
            {user.name} <span className="zg-badge zg-badge-role">{ROLE_LABEL[user.role]}</span>
          </span>
          <button type="button" className="btn btn-sm btn-outline-light zg-touch-target" onClick={() => void handleLogout()}>
            Logout
          </button>
        </div>
      </header>

      <main className="container py-5 px-3" style={{ maxWidth: 452 }}>
        <h1 className="h4 mb-2">Change Your Password</h1>
        {mandatory && <p className="text-muted">You must change your password to continue.</p>}

        {apiFailure && (
          <div className="zg-alert-error rounded p-3 mb-3" role="alert">
            Unable to change the password right now. Your entries were kept, so you can try again.
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} noValidate aria-label="Change password">
          <PasswordField
            id="cp-current"
            label={mandatory ? "Current (temporary) password *" : "Current password *"}
            noun="current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            error={errors.currentPassword}
            autoComplete="current-password"
            autoFocus
          />
          <PasswordField
            id="cp-new"
            label="New password *"
            noun="new password"
            value={newPassword}
            onChange={setNewPassword}
            error={errors.newPassword}
            autoComplete="new-password"
            describedBy="cp-rules"
          />
          <ul id="cp-rules" className="list-unstyled small mb-3" aria-label="Password requirements">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.met(newPassword);
              return (
                <li key={rule.id} className={met ? "zg-rule-met" : "zg-rule-unmet"} data-met={met}>
                  <span aria-hidden="true">{met ? "✓" : "○"} </span>
                  {rule.label}
                  <span className="visually-hidden">{met ? ": met" : ": not met"}</span>
                </li>
              );
            })}
          </ul>
          <PasswordField
            id="cp-confirm"
            label="Confirm new password *"
            noun="password confirmation"
            value={confirmPassword}
            onChange={setConfirmPassword}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />

          <button type="submit" className="btn zg-btn-primary w-100 zg-touch-target" disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </form>
      </main>
    </div>
  );
}
