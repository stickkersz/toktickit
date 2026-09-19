import { Ref, useState } from "react";

interface PasswordFieldProps {
  id: string;
  label: string;
  // Names what the toggle reveals, e.g. "current password": "Show current password".
  noun: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  autoComplete: string;
  inputRef?: Ref<HTMLInputElement>;
  describedBy?: string;
  autoFocus?: boolean;
}

// ui-spec §12: the show/hide toggle is a real button whose aria-label reflects
// its current action, and it never removes the field's own label.
export default function PasswordField({
  id,
  label,
  noun,
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
  inputRef,
  describedBy,
  autoFocus,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const described = [error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined;
  const action = `${visible ? "Hide" : "Show"} ${noun}`;

  return (
    <div className="mb-1">
      <label htmlFor={id} className="form-label fw-semibold">
        {label}
      </label>
      <div className="input-group">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          className={`form-control${error ? " is-invalid" : ""}`}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={256}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        <button
          type="button"
          className="btn btn-outline-secondary zg-touch-target"
          aria-label={action}
          title={action}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {/* The slot is always rendered so an error appearing never moves the controls
          below it. Blur validation would otherwise shift the Sign In button out
          from under a click already in progress. */}
      <div className="zg-field-feedback small">
        {error && (
          <div id={errorId} className="zg-field-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
