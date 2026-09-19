import { FormEvent, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, login } from "../api.js";
import { useAuth } from "../authContext.js";
import PasswordField from "../PasswordField.js";
import { landingPathFor } from "../roles.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Failure = "none" | "credentials" | "inactive" | "api";

function emailError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return "Email address is required.";
  if (!EMAIL_PATTERN.test(trimmed)) return "Enter a valid email address.";
  return undefined;
}

function passwordError(value: string): string | undefined {
  return value === "" ? "Password is required." : undefined;
}

// ui-spec §4: the only screen reachable with no session.
export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>("none");
  const passwordRef = useRef<HTMLInputElement>(null);
  // State updates are asynchronous, so a double click could otherwise send two
  // requests before `busy` has re-rendered the button as disabled.
  const inFlight = useRef(false);

  // Someone who is already signed in has no use for this screen.
  if (user) {
    return <Navigate to={user.mustChangePassword ? "/change-password" : landingPathFor(user.role)} replace />;
  }

  const errors = {
    email: touched.email ? emailError(email) : undefined,
    password: touched.password ? passwordError(password) : undefined,
  };

  async function submit() {
    setTouched({ email: true, password: true });
    if (emailError(email) || passwordError(password)) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure("none");
    try {
      const signedIn = await login(email.trim(), password);
      signIn(signedIn);
      navigate(signedIn.mustChangePassword ? "/change-password" : landingPathFor(signedIn.role), { replace: true });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === "INVALID_CREDENTIALS") {
        // The email is kept, the password is cleared (ui-spec §4).
        setFailure("credentials");
        setPassword("");
        setTouched((t) => ({ ...t, password: false }));
        passwordRef.current?.focus();
      } else if (code === "ACCOUNT_INACTIVE") {
        setFailure("inactive");
        setPassword("");
        setTouched((t) => ({ ...t, password: false }));
      } else {
        // Values stay in place so Retry can resend them unchanged.
        setFailure("api");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <div className="container py-5 px-3" style={{ maxWidth: 452 }}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="zg-wordmark-icon">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        <span className="h4 mb-0 zg-wordmark">TokTickIT</span>
      </div>
      <h1 className="h4 mb-3">Sign in to your account</h1>

      {failure === "credentials" && (
        <div className="zg-alert-error rounded p-3 mb-3" role="alert">
          Invalid email or password. Please try again.
        </div>
      )}
      {failure === "inactive" && (
        <div className="zg-alert-warning rounded p-3 mb-3" role="alert">
          This account is inactive. Contact an administrator.
        </div>
      )}
      {failure === "api" && (
        <div className="zg-alert-error rounded p-3 mb-3" role="alert">
          <p className="mb-2">Unable to sign in right now. Please try again.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
            Retry
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate aria-label="Sign in">
        <div className="mb-1">
          <label htmlFor="login-email" className="form-label fw-semibold">
            Email address *
          </label>
          <input
            id="login-email"
            type="email"
            className={`form-control${errors.email ? " is-invalid" : ""}`}
            value={email}
            autoComplete="username"
            autoFocus
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "login-email-error" : undefined}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          />
          <div className="zg-field-feedback small">
            {errors.email && (
              <div id="login-email-error" className="zg-field-error">
                {errors.email}
              </div>
            )}
          </div>
        </div>

        <PasswordField
          id="login-password"
          label="Password *"
          noun="password"
          value={password}
          onChange={setPassword}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          error={errors.password}
          autoComplete="current-password"
          inputRef={passwordRef}
        />

        <button type="submit" className="btn zg-btn-primary w-100 zg-touch-target" disabled={busy}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
