import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  // A field's rule error shows once the field has been left or a submit was tried, and follows what is
  // typed from then on; a server error shows until that field is edited (validation on blur, Lab 2 and
  // Lab 3 pattern; found stale by the final screen pass).
  const [shown, setShown] = useState<Record<keyof Fields, boolean>>({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [serverErrors, setServerErrors] = useState<Fields>({});
  const [apiFailure, setApiFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  // A voluntary change (from the header) stays on this screen and says it worked.
  const [done, setDone] = useState(false);

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

  const live = validate();
  const errors: Fields = {
    currentPassword: serverErrors.currentPassword ?? (shown.currentPassword ? live.currentPassword : undefined),
    newPassword: serverErrors.newPassword ?? (shown.newPassword ? live.newPassword : undefined),
    confirmPassword: serverErrors.confirmPassword ?? (shown.confirmPassword ? live.confirmPassword : undefined),
  };
  const edit = (field: keyof Fields, set: (v: string) => void) => (value: string) => {
    set(value);
    setServerErrors((s) => (s[field] ? { ...s, [field]: undefined } : s));
  };
  const leave = (field: keyof Fields) => () => setShown((s) => ({ ...s, [field]: true }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = validate();
    setShown({ currentPassword: true, newPassword: true, confirmPassword: true });
    setServerErrors({});
    setApiFailure(false);
    // A new attempt replaces the outcome of the last one, so an earlier success is never shown
    // beside a failure.
    setDone(false);
    // The server would refuse this too; no request is made for a form that is
    // already known to be invalid.
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const updated = await changePassword({ currentPassword, newPassword, confirmPassword });
      signIn(updated);
      if (mandatory) {
        navigate(landingPathFor(updated.role), { replace: true });
        return;
      }
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      if (e instanceof ValidationError) {
        setServerErrors(e.fields);
      } else if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS") {
        setServerErrors({ currentPassword: "Current password is incorrect." });
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

        {done && (
          <div className="zg-banner-pale rounded p-3 mb-3" role="status">
            Your password has been changed. Your other sessions have been signed out.
          </div>
        )}

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
            onChange={edit("currentPassword", setCurrentPassword)}
            onBlur={leave("currentPassword")}
            error={errors.currentPassword}
            autoComplete="current-password"
            autoFocus
          />
          <PasswordField
            id="cp-new"
            label="New password *"
            noun="new password"
            value={newPassword}
            onChange={edit("newPassword", setNewPassword)}
            onBlur={leave("newPassword")}
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
            onChange={edit("confirmPassword", setConfirmPassword)}
            onBlur={leave("confirmPassword")}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />

          <button type="submit" className="btn zg-btn-primary w-100 zg-touch-target" disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </form>

        {!mandatory && (
          <div className="text-center mt-3">
            <Link to={landingPathFor(user.role)} className="zg-touch-target">
              {done ? "Back to your home screen" : "Cancel and go back"}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
