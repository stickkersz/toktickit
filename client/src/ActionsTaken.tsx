import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ActionInput,
  ActionItem,
  ApiError,
  StaffOwner,
  ValidationError,
  cancelAction,
  completeAction,
  createAction,
  getTicketActions,
  updateAction,
} from "./api.js";
import { RequiredMark } from "./RequiredMark.js";

// Lab 4 Actions Taken (ui-spec.md sections 7 and 8). One list, shown with every control to IT Staff and
// Administrators and read-only to the Requester who owns the Ticket.

// BR-14: the Ticket statuses in which Actions may be written.
const WORKABLE = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"];

// BR-03, BR-04, BR-10, BR-11. The server decides; these only save a round trip.
const LIMITS = { description: [5, 2000], followUpNote: [5, 1000], attachmentNotes: 1000, result: [5, 2000], reason: [5, 500] } as const;

// Times are stored in UTC and shown, and entered, in Asia/Bangkok, which has no daylight saving (BR-29).
const BANGKOK_OFFSET = 7 * 60 * 60 * 1000;
// The same style as every other date on the Ticket Detail (attachmentDisplay formatDate), pinned to Bangkok.
export const formatBangkok = (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone: "Asia/Bangkok" });
// The value of a datetime-local input, in Bangkok time, for an instant.
const toLocalInput = (date: Date) => new Date(date.getTime() + BANGKOK_OFFSET).toISOString().slice(0, 16);
// The instant a datetime-local value names in Bangkok, or null when it is not a full date and time.
function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// A datetime-local value names a whole minute. The minute the Ticket was created in therefore stands for
// any moment of it, so a time in that minute is sent as no earlier than the creation itself (BR-05); an
// earlier minute is refused under the field before anything is sent.
const MINUTE = 60_000;
function atOrAfterCreation(iso: string, ticketCreatedAt: string): string {
  return Date.parse(iso) < Date.parse(ticketCreatedAt) ? ticketCreatedAt : iso;
}
function beforeCreation(iso: string, ticketCreatedAt: string): boolean {
  return Date.parse(iso) < Math.floor(Date.parse(ticketCreatedAt) / MINUTE) * MINUTE;
}
const BEFORE_CREATION = "Action date/time cannot be earlier than when the Ticket was created.";

const newKey = () => crypto.randomUUID();

const sortActions = (list: ActionItem[]) =>
  [...list].sort((a, b) => a.actionAt.localeCompare(b.actionAt) || a.id - b.id);

const STATUS_BADGE = {
  PLANNED: { label: "Planned", className: "zg-badge-action-planned" },
  COMPLETED: { label: "Completed", className: "zg-badge-action-completed" },
  CANCELLED: { label: "Cancelled", className: "zg-badge-action-cancelled" },
} as const;

// ui-spec.md section 2: text plus colour, never colour alone.
export function ActionStatusBadge({ status }: { status: ActionItem["status"] }) {
  const b = STATUS_BADGE[status];
  return <span className={`zg-badge ${b.className}`}>{b.label}</span>;
}
const FollowUpBadge = () => <span className="zg-badge zg-badge-followup">Follow-up needed</span>;
function PersonName({ person }: { person: ActionItem["responsibleStaff"] }) {
  return (
    <span>
      {person.name}
      {!person.eligible && (
        <>
          {" "}
          <span className="zg-badge zg-badge-not-active">Not active</span>
        </>
      )}
    </span>
  );
}

// The list of a Ticket's Actions, loaded once and kept here so the tab count and the panel share it.
export interface ActionsState {
  items: ActionItem[];
  state: "loading" | "ready" | "error";
  count: number | null;
  reload: () => void;
  replace: (item: ActionItem) => void;
}

export function useActions(ticketId: number): ActionsState {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [state, setState] = useState<ActionsState["state"]>("loading");
  const loadId = useRef(0);
  const reload = useCallback(() => {
    const id = ++loadId.current;
    setState((s) => (s === "ready" ? s : "loading"));
    getTicketActions(ticketId).then(
      (list) => {
        if (loadId.current !== id) return;
        setItems(sortActions(list));
        setState("ready");
      },
      () => {
        if (loadId.current === id) setState("error");
      },
    );
  }, [ticketId]);
  useEffect(reload, [reload]);
  const replace = useCallback((item: ActionItem) => {
    setItems((list) => sortActions([...list.filter((a) => a.id !== item.id), item]));
  }, []);
  return { items, state, count: state === "ready" ? items.length : null, reload, replace };
}

// Whether the window is at least `px` wide, following resizes. Only one of the table and the cards is
// rendered, so an open Action's detail and edit form exist once in the page, never twice with the same
// field ids. Without matchMedia (the test environment) the desktop table is used.
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const get = () => typeof window.matchMedia !== "function" || window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function activateOnKey(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  };
}

interface Notice {
  kind: "success" | "conflict";
  text: string;
}

// ---------------------------------------------------------------------------------------------------
// The list, shared by both roles. Rows and cards open the Action's detail by click, Enter, or Space.
// ---------------------------------------------------------------------------------------------------

function ActionList({
  actions,
  openId,
  onToggle,
  renderDetail,
  rowRefs,
}: {
  actions: ActionItem[];
  openId: number | null;
  onToggle: (id: number) => void;
  renderDetail: (a: ActionItem) => ReactNode;
  rowRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  const wide = useMinWidth(768);
  if (wide)
    return (
      /* Table from 768px; Performed By moves into the detail below 992px (ui-spec.md section 7). */
      <div className="table-responsive">
        <table className="table align-middle mb-0">
          <thead>
            <tr>
              <th>Action Date/Time</th>
              <th>Description</th>
              <th>Responsible</th>
              <th>Status</th>
              <th>Follow-up</th>
              <th className="d-none d-lg-table-cell">Performed By</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <FragmentRow key={a.id}>
                <tr
                  ref={(el) => {
                    rowRefs.current[`row-${a.id}`] = el;
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={openId === a.id}
                  className={`zg-clickable-row${a.status === "CANCELLED" ? " text-muted" : ""}`}
                  onClick={() => onToggle(a.id)}
                  onKeyDown={activateOnKey(() => onToggle(a.id))}
                >
                  <td className="text-nowrap">{formatBangkok(a.actionAt)}</td>
                  <td className="zg-action-description">{a.description}</td>
                  <td>
                    <PersonName person={a.responsibleStaff} />
                  </td>
                  <td>
                    <ActionStatusBadge status={a.status} />
                  </td>
                  <td>{a.followUpRequired ? <FollowUpBadge /> : <span className="text-muted">No</span>}</td>
                  <td className="d-none d-lg-table-cell">{a.performedBy?.name ?? <span className="text-muted">Not yet</span>}</td>
                </tr>
                {openId === a.id && (
                  <tr className="zg-action-detail-row">
                    <td colSpan={6}>{renderDetail(a)}</td>
                  </tr>
                )}
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    /* Below 768px: one card per Action, status and date first (ui-spec.md section 7). */
    <div>
        {actions.map((a) => (
          <div key={a.id} className="card mb-2">
            <div
              ref={(el) => {
                rowRefs.current[`card-${a.id}`] = el;
              }}
              className="card-body zg-clickable-row"
              role="button"
              tabIndex={0}
              aria-expanded={openId === a.id}
              onClick={() => onToggle(a.id)}
              onKeyDown={activateOnKey(() => onToggle(a.id))}
            >
              <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                <ActionStatusBadge status={a.status} />
                <span className="small text-muted">{formatBangkok(a.actionAt)}</span>
              </div>
              <div className="my-1 zg-action-description">{a.description}</div>
              <dl className="row small mb-0 g-0">
                <dt className="col-5 text-muted fw-normal">Responsible</dt>
                <dd className="col-7 mb-1">
                  <PersonName person={a.responsibleStaff} />
                </dd>
                <dt className="col-5 text-muted fw-normal">Follow-up</dt>
                <dd className="col-7 mb-0">{a.followUpRequired ? <FollowUpBadge /> : "No"}</dd>
              </dl>
            </div>
            {openId === a.id && <div className="card-body border-top">{renderDetail(a)}</div>}
          </div>
        ))}
    </div>
  );
}

const FragmentRow = ({ children }: { children: ReactNode }) => <>{children}</>;

// The read-only fields of an Action: the same for both roles (BR-17), every field present.
function ActionFields({ a }: { a: ActionItem }) {
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="col-sm-4 text-muted fw-normal">{label}</dt>
      <dd className="col-sm-8">{value}</dd>
    </>
  );
  return (
    <dl className="row small mb-2">
      {row("Action Date/Time", formatBangkok(a.actionAt))}
      {row("Status", <ActionStatusBadge status={a.status} />)}
      {row("Description", <span className="zg-action-description">{a.description}</span>)}
      {row("Responsible Staff", <PersonName person={a.responsibleStaff} />)}
      {row("Follow-Up Required", a.followUpRequired ? "Yes" : "No")}
      {a.followUpRequired && row("Follow-Up Note", <span className="zg-action-description">{a.followUpNote}</span>)}
      {row("Attachment Notes", a.attachmentNotes ? <span className="zg-action-description">{a.attachmentNotes}</span> : <span className="text-muted">None</span>)}
      {row("Recorded By", `${a.recordedBy.name}, ${formatBangkok(a.recordedAt)}`)}
      {a.lastEditedBy && a.lastEditedBy.id !== a.recordedBy.id && row("Last Edited By", a.lastEditedBy.name)}
      {a.status === "COMPLETED" && row("Result", <span className="zg-action-description">{a.result}</span>)}
      {a.status === "COMPLETED" && row("Performed By", `${a.performedBy?.name ?? ""}, ${a.completedAt ? formatBangkok(a.completedAt) : ""}`)}
      {a.status === "CANCELLED" && row("Cancelled By", `${a.cancelledBy?.name ?? ""}, ${a.cancelledAt ? formatBangkok(a.cancelledAt) : ""}`)}
      {a.status === "CANCELLED" && row("Reason", a.cancelReason)}
    </dl>
  );
}

function ListState({ actions, emptyText }: { actions: ActionsState; emptyText: string }) {
  if (actions.state === "loading") return <p className="text-muted">Loading actions...</p>;
  if (actions.state === "error")
    return (
      <div className="zg-alert-error rounded p-2 d-flex justify-content-between align-items-center gap-2" role="alert">
        <span>Unable to load the actions.</span>
        <button type="button" className="btn btn-sm btn-outline-secondary zg-touch-target" onClick={actions.reload}>
          Retry
        </button>
      </div>
    );
  if (actions.items.length === 0) return <p className="text-muted mb-0">{emptyText}</p>;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Requester Ticket Detail (ui-spec.md section 8): read-only, no control of any kind.
// ---------------------------------------------------------------------------------------------------

export function RequesterActionsTaken({ ticketId }: { ticketId: number }) {
  const actions = useActions(ticketId);
  const [openId, setOpenId] = useState<number | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  return (
    <section aria-labelledby="requester-actions-heading" className="mb-4">
      <h2 id="requester-actions-heading" className="h5">
        Actions Taken{actions.count !== null ? ` (${actions.count})` : ""}
      </h2>
      <ListState actions={actions} emptyText="IT has not recorded any actions yet." />
      {actions.state === "ready" && actions.items.length > 0 && (
        <ActionList
          actions={actions.items}
          openId={openId}
          onToggle={(id) => setOpenId((o) => (o === id ? null : id))}
          renderDetail={(a) => <ActionFields a={a} />}
          rowRefs={rowRefs}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// IT Staff and Administrator panel (ui-spec.md section 7).
// ---------------------------------------------------------------------------------------------------

interface FormValues {
  actionAt: string; // datetime-local, Bangkok
  description: string;
  responsibleStaffId: string;
  followUpRequired: boolean;
  followUpNote: string;
  attachmentNotes: string;
}

const valuesOf = (a: ActionItem): FormValues => ({
  actionAt: toLocalInput(new Date(a.actionAt)),
  description: a.description,
  responsibleStaffId: String(a.responsibleStaff.id),
  followUpRequired: a.followUpRequired,
  followUpNote: a.followUpNote ?? "",
  attachmentNotes: a.attachmentNotes ?? "",
});

function validate(v: FormValues, ticketCreatedAt: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const len = (s: string) => s.trim().length;
  const at = fromLocalInput(v.actionAt);
  if (at === null) errors.actionAt = "Enter the date and time of the action.";
  else if (beforeCreation(at, ticketCreatedAt)) errors.actionAt = BEFORE_CREATION;
  if (len(v.description) < LIMITS.description[0] || len(v.description) > LIMITS.description[1])
    errors.description = `Description must be between ${LIMITS.description[0]} and ${LIMITS.description[1]} characters.`;
  if (!v.responsibleStaffId) errors.responsibleStaffId = "Choose the responsible staff member.";
  if (v.followUpRequired && (len(v.followUpNote) < LIMITS.followUpNote[0] || len(v.followUpNote) > LIMITS.followUpNote[1]))
    errors.followUpNote = `Follow-up note must be between ${LIMITS.followUpNote[0]} and ${LIMITS.followUpNote[1]} characters.`;
  if (len(v.attachmentNotes) > LIMITS.attachmentNotes) errors.attachmentNotes = `Attachment notes must be at most ${LIMITS.attachmentNotes} characters.`;
  return errors;
}

function toInput(v: FormValues, ticketCreatedAt: string): ActionInput {
  return {
    actionAt: atOrAfterCreation(fromLocalInput(v.actionAt)!, ticketCreatedAt),
    description: v.description.trim(),
    responsibleStaffId: Number(v.responsibleStaffId),
    followUpRequired: v.followUpRequired,
    ...(v.followUpRequired ? { followUpNote: v.followUpNote.trim() } : {}),
    ...(v.attachmentNotes.trim() ? { attachmentNotes: v.attachmentNotes.trim() } : {}),
  };
}

// The server's answer to a refused save, for the form to show.
interface FormProblem {
  message?: string;
  fields?: Record<string, string>;
  stale?: ActionItem;
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className="text-muted small">{value.trim().length} / {max}</span>;
}

function TextField(props: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  error?: string;
  max: number;
  rows?: number;
  helper?: string;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const describedBy = [props.helper ? `${props.id}-help` : "", props.error ? `${props.id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="mb-1">
      <div className="d-flex justify-content-between align-items-baseline gap-2">
        <label htmlFor={props.id} className="form-label fw-semibold mb-1">
          {props.label} {props.required && <RequiredMark />}
        </label>
        <Counter value={props.value} max={props.max} />
      </div>
      <textarea
        id={props.id}
        ref={props.inputRef}
        className={`form-control zg-editable${props.error ? " is-invalid" : ""}`}
        rows={props.rows ?? 3}
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={props.required ? true : undefined}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
      />
      {props.helper && (
        <div id={`${props.id}-help`} className="form-text">
          {props.helper}
        </div>
      )}
      <div className="zg-field-feedback small">{props.error && <div id={`${props.id}-error`} className="zg-field-error">{props.error}</div>}</div>
    </div>
  );
}

// Create and edit share one form. In edit mode Save stays disabled until something changed.
function ActionForm({
  idPrefix,
  mode,
  ticketCreatedAt,
  initial,
  owners,
  current,
  busy,
  problem,
  onSubmit,
  onCancel,
  onUseMine,
  onDiscardMine,
  onEdited,
  draft,
}: {
  idPrefix: string;
  mode: "create" | "edit";
  ticketCreatedAt: string;
  initial: FormValues;
  owners: StaffOwner[];
  current?: ActionItem;
  busy: boolean;
  problem: FormProblem | null;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  onUseMine?: (values: FormValues) => void;
  onDiscardMine?: () => void;
  onEdited: () => void;
  // What was typed, held by the panel: the table and the cards are swapped when the window crosses
  // 768px (a tablet rotated), which remounts the open form, and nothing typed may be lost to that.
  draft: React.MutableRefObject<FormValues | null>;
}) {
  const [values, setValuesState] = useState(() => draft.current ?? initial);
  const setValues = (update: (v: FormValues) => FormValues) =>
    setValuesState((v) => {
      const next = update(v);
      draft.current = next;
      return next;
    });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  // A button that was pressed inside a callout or confirmation is gone once that closes; focus then goes
  // back into the form instead of falling to the page (review on #84).
  useEffect(() => {
    if (busy) return;
    if (document.activeElement === document.body || document.activeElement === null) submitRef.current?.focus();
  }, [problem, busy]);
  // Focus moves in when the form opens, not when a layout change remounts it mid-edit.
  const reopened = useRef(draft.current !== null);
  useEffect(() => {
    if (!reopened.current) firstRef.current?.focus();
  }, []);

  const local = validate(values, ticketCreatedAt);
  const shown = (field: keyof FormValues) => (touched[field] || submitted ? local[field] : undefined) ?? problem?.fields?.[field];
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    onEdited();
  };
  const blur = (field: keyof FormValues) => () => setTouched((t) => ({ ...t, [field]: true }));
  const id = (field: string) => `${idPrefix}-${field}`;

  // A Responsible Staff member who is no longer eligible stays visible as the current value only.
  const currentResponsible = current && !current.responsibleStaff.eligible ? current.responsibleStaff : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(local).length > 0) return;
    onSubmit(values);
  }

  const err = (field: keyof FormValues) => shown(field);
  const described = (field: keyof FormValues) => (err(field) ? `${id(field)}-error` : undefined);

  return (
    <form className="zg-action-form border rounded p-3 mb-3" noValidate onSubmit={submit} aria-label={mode === "create" ? "Add Action" : "Edit Action"}>
      {problem?.stale && (
        <div className="zg-alert-warning rounded p-2 mb-3" role="alert">
          <p className="mb-2">Someone else changed this action. The latest version is shown below; your changes are still in the form.</p>
          <ActionFields a={problem.stale} />
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-sm zg-btn-primary zg-touch-target" disabled={busy} onClick={() => onUseMine?.(values)}>
              Use my changes
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary zg-touch-target" disabled={busy} onClick={onDiscardMine}>
              Discard my changes
            </button>
          </div>
        </div>
      )}

      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label htmlFor={id("actionAt")} className="form-label fw-semibold mb-1">
            Action Date/Time <RequiredMark />
          </label>
          <input
            id={id("actionAt")}
            ref={firstRef}
            type="datetime-local"
            className={`form-control zg-editable${err("actionAt") ? " is-invalid" : ""}`}
            value={values.actionAt}
            aria-invalid={err("actionAt") ? true : undefined}
            aria-describedby={[`${id("actionAt")}-help`, described("actionAt")].filter(Boolean).join(" ")}
            aria-required
            onChange={(e) => set("actionAt", e.target.value)}
            onBlur={blur("actionAt")}
          />
          <div id={`${id("actionAt")}-help`} className="form-text">
            Bangkok time.
          </div>
          <div className="zg-field-feedback small">{err("actionAt") && <div id={`${id("actionAt")}-error`} className="zg-field-error">{err("actionAt")}</div>}</div>
        </div>
        <div className="col-12 col-md-6">
          <label htmlFor={id("responsibleStaffId")} className="form-label fw-semibold mb-1">
            Responsible Staff <RequiredMark />
          </label>
          <select
            id={id("responsibleStaffId")}
            className={`form-select zg-editable${err("responsibleStaffId") ? " is-invalid" : ""}`}
            value={values.responsibleStaffId}
            aria-invalid={err("responsibleStaffId") ? true : undefined}
            aria-describedby={described("responsibleStaffId")}
            aria-required
            onChange={(e) => set("responsibleStaffId", e.target.value)}
            onBlur={blur("responsibleStaffId")}
          >
            {currentResponsible && (
              <option value={String(currentResponsible.id)} disabled>
                {currentResponsible.name} (Not active)
              </option>
            )}
            {owners.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </select>
          <div className="zg-field-feedback small">
            {err("responsibleStaffId") && (
              <div id={`${id("responsibleStaffId")}-error`} className="zg-field-error">
                {err("responsibleStaffId")}
              </div>
            )}
          </div>
        </div>
        <div className="col-12">
          <TextField
            id={id("description")}
            label="Action Description"
            required
            value={values.description}
            error={err("description")}
            max={LIMITS.description[1]}
            onChange={(v) => set("description", v)}
            onBlur={blur("description")}
          />
        </div>
        <div className="col-12">
          <div className="form-check">
            <input
              id={id("followUpRequired")}
              type="checkbox"
              className="form-check-input"
              checked={values.followUpRequired}
              onChange={(e) => set("followUpRequired", e.target.checked)}
            />
            <label htmlFor={id("followUpRequired")} className="form-check-label fw-semibold">
              Follow-Up Required
            </label>
          </div>
        </div>
        {/* BR-04: shown, required, and marked only while follow-up is required. */}
        {values.followUpRequired && (
          <div className="col-12">
            <TextField
              id={id("followUpNote")}
              label="Follow-Up Note"
              required
              value={values.followUpNote}
              error={err("followUpNote")}
              max={LIMITS.followUpNote[1]}
              rows={2}
              onChange={(v) => set("followUpNote", v)}
              onBlur={blur("followUpNote")}
            />
          </div>
        )}
        <div className="col-12">
          <TextField
            id={id("attachmentNotes")}
            label="Attachment Notes"
            value={values.attachmentNotes}
            error={err("attachmentNotes")}
            max={LIMITS.attachmentNotes}
            rows={2}
            helper="Which file to look at, for example a photo in Attachments."
            onChange={(v) => set("attachmentNotes", v)}
            onBlur={blur("attachmentNotes")}
          />
        </div>
      </div>

      {problem?.message && !problem.stale && (
        <div className="zg-alert-error rounded p-2 mt-2" role="alert">
          {problem.message}
        </div>
      )}
      {confirmDiscard && (
        <div className="border rounded p-2 mt-2 d-flex justify-content-between align-items-center gap-2 flex-wrap" role="group" aria-label="Discard what you typed">
          <span>Discard the action you started? What you typed will be lost.</span>
          <span className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary zg-touch-target"
              onClick={() => {
                setConfirmDiscard(false);
                cancelRef.current?.focus();
              }}
            >
              Keep editing
            </button>
            <button type="button" className="btn btn-sm zg-btn-primary zg-touch-target" onClick={() => onCancel()}>
              Discard
            </button>
          </span>
        </div>
      )}
      <div className="d-flex gap-2 justify-content-end mt-2 flex-wrap">
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-outline-secondary zg-touch-target"
          disabled={busy}
          // Create mode asks first when anything was typed (ui-spec.md section 7); Discard in edit mode
          // drops the changes at once, as its name says.
          onClick={() => (mode === "create" && dirty ? setConfirmDiscard(true) : onCancel())}
        >
          {mode === "create" ? "Cancel" : "Discard"}
        </button>
        <button ref={submitRef} type="submit" className="btn zg-btn-primary zg-touch-target" disabled={busy || (mode === "edit" && !dirty) || !!problem?.stale}>
          {busy ? "Saving..." : mode === "create" ? "Save Action" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

// A modal dialog (ui-spec.md section 7): labelled, focus moved in and kept in, Escape closes, and focus
// returns to the control that opened it.
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("textarea, input, select, button");
    first?.focus();
    return () => opener?.focus();
  }, []);
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>("textarea, input, select, button:not(:disabled)")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  return (
    <div className="zg-dialog-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="zg-dialog-title" className="zg-dialog" onKeyDown={onKeyDown}>
        <h2 id="zg-dialog-title" className="h5">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

const shortTitle = (a: ActionItem) => (a.description.length > 60 ? `${a.description.slice(0, 57)}...` : a.description);

function CompleteDialog({ action, ticketCreatedAt, busy, problem, onSubmit, onClose }: { action: ActionItem; ticketCreatedAt: string; busy: boolean; problem: FormProblem | null; onSubmit: (result: string, actionAt: string) => void; onClose: () => void }) {
  // Pre-filled with the stored time, or now when that is still in the future, and always sent (BR-05).
  const [actionAt, setActionAt] = useState(() => toLocalInput(new Date(Math.min(Date.parse(action.actionAt), Date.now()))));
  const [result, setResult] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState(false);
  const len = result.trim().length;
  const resultError =
    (submitted || touched) && (len < LIMITS.result[0] || len > LIMITS.result[1]) ? `Result must be between ${LIMITS.result[0]} and ${LIMITS.result[1]} characters.` : problem?.fields?.result;
  const iso = fromLocalInput(actionAt);
  const atError =
    (submitted && iso === null ? "Enter the date and time the work was done." : submitted && iso && beforeCreation(iso, ticketCreatedAt) ? BEFORE_CREATION : undefined) ??
    problem?.fields?.actionAt;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (len < LIMITS.result[0] || len > LIMITS.result[1] || iso === null || beforeCreation(iso, ticketCreatedAt)) return;
    onSubmit(result.trim(), atOrAfterCreation(iso, ticketCreatedAt));
  }
  return (
    <Dialog title={`Complete Action: ${shortTitle(action)}`} onClose={onClose}>
      <form noValidate onSubmit={submit}>
        <TextField id="complete-result" label="Result" required value={result} error={resultError} max={LIMITS.result[1]} onChange={setResult} onBlur={() => setTouched(true)} />
        <label htmlFor="complete-actionAt" className="form-label fw-semibold mb-1">
          Action Date/Time <RequiredMark />
        </label>
        <input
          id="complete-actionAt"
          type="datetime-local"
          className={`form-control zg-editable${atError ? " is-invalid" : ""}`}
          value={actionAt}
          aria-required
          aria-invalid={atError ? true : undefined}
          aria-describedby={atError ? "complete-actionAt-error" : undefined}
          onChange={(e) => setActionAt(e.target.value)}
        />
        <div className="zg-field-feedback small">{atError && <div id="complete-actionAt-error" className="zg-field-error">{atError}</div>}</div>
        <p className="form-text">Once completed, this action cannot be changed.</p>
        {problem?.message && (
          <div className="zg-alert-warning rounded p-2 mb-2" role="alert">
            {problem.message}
          </div>
        )}
        <div className="d-flex gap-2 justify-content-end flex-wrap mt-3">
          <button type="button" className="btn btn-outline-secondary zg-touch-target" onClick={onClose}>
            Keep Planned
          </button>
          <button type="submit" className="btn zg-btn-primary zg-touch-target" disabled={busy}>
            {busy ? "Saving..." : "Mark as Completed"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({ action, busy, problem, onSubmit, onClose }: { action: ActionItem; busy: boolean; problem: FormProblem | null; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(false);
  const len = reason.trim().length;
  const error = shown && (len < LIMITS.reason[0] || len > LIMITS.reason[1]) ? `Reason must be between ${LIMITS.reason[0]} and ${LIMITS.reason[1]} characters.` : problem?.fields?.reason;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setShown(true);
    if (len < LIMITS.reason[0] || len > LIMITS.reason[1]) return;
    onSubmit(reason.trim());
  }
  return (
    <Dialog title={`Cancel Action: ${shortTitle(action)}`} onClose={onClose}>
      <form noValidate onSubmit={submit}>
        <TextField id="cancel-reason" label="Reason" required value={reason} error={error} max={LIMITS.reason[1]} rows={2} onChange={setReason} onBlur={() => setShown(true)} />
        {problem?.message && (
          <div className="zg-alert-warning rounded p-2 mb-2" role="alert">
            {problem.message}
          </div>
        )}
        <div className="d-flex gap-2 justify-content-end flex-wrap mt-3">
          <button type="button" className="btn btn-outline-secondary zg-touch-target" onClick={onClose}>
            Keep Action
          </button>
          <button type="submit" className="btn zg-btn-primary zg-touch-target" disabled={busy}>
            {busy ? "Saving..." : "Cancel Action"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const finalNotice = (a: ActionItem): string => {
  const who = a.status === "COMPLETED" ? `Completed by ${a.performedBy?.name}` : `Cancelled by ${a.cancelledBy?.name}`;
  const when = a.status === "COMPLETED" ? a.completedAt : a.cancelledAt;
  return `This action is already completed or cancelled. ${who}${when ? `, ${formatBangkok(when)}` : ""}.`;
};
const NOT_WORKABLE = "This ticket's status changed, so its actions can no longer be changed. The list and status have been reloaded.";

export function StaffActionsTaken({
  ticketId,
  ticketCreatedAt,
  ticketStatus,
  owners,
  currentUserId,
  actions,
  onTicketChanged,
  onOwnersStale,
  onActionsChanged,
}: {
  ticketId: number;
  ticketCreatedAt: string;
  ticketStatus: string;
  owners: StaffOwner[];
  currentUserId: number;
  actions: ActionsState;
  onTicketChanged: () => void;
  onOwnersStale: () => void;
  // After every Action write that succeeded or was found already final: the Ticket's resolution gate and
  // the Cancel confirmation's count are derived from the Actions, so the screen re-reads them (review on #85).
  onActionsChanged: () => void;
}) {
  const workable = WORKABLE.includes(ticketStatus);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ kind: "complete" | "cancel"; id: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [formKey, setFormKey] = useState(0);
  const busyRef = useRef(false);
  const keyRef = useRef(newKey());
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const addRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<number | "add" | "notice" | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // The open form's typed values, kept across a remount (see ActionForm). Cleared whenever a form opens or closes.
  const draft = useRef<FormValues | null>(null);

  // A status change elsewhere on the screen (or a cancel that cascaded, BR-15) changes the Actions too.
  const firstStatus = useRef(ticketStatus);
  useEffect(() => {
    if (ticketStatus !== firstStatus.current) actions.reload();
    firstStatus.current = ticketStatus;
  }, [ticketStatus, actions]);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === "add") addRef.current?.focus();
    else if (target === "notice") noticeRef.current?.focus();
    else (rowRefs.current[`row-${target}`] ?? rowRefs.current[`card-${target}`])?.focus();
  });

  const byId = (id: number | null) => actions.items.find((a) => a.id === id) ?? null;

  // The shared handling of a refused write (ui-spec.md section 7, Conflicts). Returns what the open form
  // or dialog should show; anything that closes it is done here.
  function refused(e: unknown, generic: string): FormProblem | null {
    if (e instanceof ValidationError) return { message: e.message, fields: e.fields };
    if (e instanceof ApiError && e.code === "STALE_ACTION" && e.action) {
      return { stale: e.action };
    }
    if (e instanceof ApiError && e.code === "ACTION_FINAL") {
      // The form or dialog closes and its buttons go with it; the Action's row stays (review on #84).
      const id = dialog?.id ?? editingId;
      if (id !== null) focusAfter.current = id;
      setEditingId(null);
      setDialog(null);
      getTicketActions(ticketId).then(
        (list) => {
          const reloaded = list.find((a) => a.id === (openId ?? dialog?.id));
          actions.reload();
          onActionsChanged();
          if (id !== null) focusAfter.current = id;
          setNotice({ kind: "conflict", text: reloaded ? finalNotice(reloaded) : "This action is already completed or cancelled." });
        },
        () => {
          actions.reload();
          // Someone else finished the Action, so the gate changed whether or not the list could be re-read.
          onActionsChanged();
          setNotice({ kind: "conflict", text: "This action is already completed or cancelled." });
        },
      );
      return null;
    }
    if (e instanceof ApiError && e.code === "TICKET_NOT_WORKABLE") {
      // Add Action, Edit, Complete, and Cancel all disappear with the workable status: focus goes to the
      // Action that was being changed, or to the explanation when a new one was being added (review on #84).
      const id = dialog?.id ?? editingId;
      focusAfter.current = id ?? "notice";
      setCreating(false);
      setEditingId(null);
      setDialog(null);
      actions.reload();
      onTicketChanged();
      setNotice({ kind: "conflict", text: NOT_WORKABLE });
      return null;
    }
    if (e instanceof ApiError && e.code === "INVALID_RESPONSIBLE") {
      onOwnersStale();
      return { fields: { responsibleStaffId: "Choose an active IT Staff member." } };
    }
    if (e instanceof ApiError && e.code === "IDEMPOTENCY_KEY_REUSED") {
      keyRef.current = newKey();
      return { message: e.message };
    }
    return { message: e instanceof ApiError && e.message ? e.message : generic };
  }

  async function guarded(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const create = (values: FormValues) =>
    guarded(async () => {
      setProblem(null);
      try {
        const created = await createAction(ticketId, toInput(values, ticketCreatedAt), keyRef.current);
        keyRef.current = newKey();
        actions.replace(created);
        onActionsChanged();
        setCreating(false);
        draft.current = null;
        setOpenId(null);
        focusAfter.current = created.id;
        setNotice({ kind: "success", text: "Action added." });
      } catch (e) {
        setProblem(refused(e, "Unable to add the action."));
      }
    });

  const save = (action: ActionItem, version: number, values: FormValues) =>
    guarded(async () => {
      setProblem(null);
      const before = valuesOf(action);
      const next = toInput(values, ticketCreatedAt);
      const changes: Partial<ActionInput> = {};
      if (values.actionAt !== before.actionAt) changes.actionAt = next.actionAt;
      if (values.description.trim() !== before.description) changes.description = next.description;
      if (values.responsibleStaffId !== before.responsibleStaffId) changes.responsibleStaffId = next.responsibleStaffId;
      if (values.followUpRequired !== before.followUpRequired) changes.followUpRequired = next.followUpRequired;
      if (values.followUpRequired && values.followUpNote.trim() !== before.followUpNote) changes.followUpNote = next.followUpNote;
      if (values.attachmentNotes.trim() !== before.attachmentNotes) changes.attachmentNotes = values.attachmentNotes.trim();
      try {
        const updated = await updateAction(action.id, version, changes);
        actions.replace(updated);
        onActionsChanged();
        setEditingId(null);
        draft.current = null;
        focusAfter.current = updated.id;
        setNotice({ kind: "success", text: "Changes saved." });
      } catch (e) {
        setProblem(refused(e, "Unable to save the action."));
      }
    });

  const finish = (action: ActionItem, kind: "complete" | "cancel", text: string, actionAt?: string) =>
    guarded(async () => {
      setProblem(null);
      try {
        const updated = kind === "complete" ? await completeAction(action.id, action.version, text, actionAt!) : await cancelAction(action.id, action.version, text);
        actions.replace(updated);
        onActionsChanged();
        setDialog(null);
        // The button that opened the dialog is gone now the Action is final, so focus goes to its row
        // (AC-49), as after create and save; the dialog's own return to its opener would land on the body.
        focusAfter.current = updated.id;
        setNotice({ kind: "success", text: kind === "complete" ? "Action completed." : "Action cancelled." });
      } catch (e) {
        const p = refused(e, kind === "complete" ? "Unable to complete the action." : "Unable to cancel the action.");
        if (p?.stale) {
          // The dialog stays open with what was typed, now against the latest version.
          actions.replace(p.stale);
          setProblem({ message: "Someone else changed this action. The latest version is now loaded; check it and try again." });
        } else setProblem(p);
      }
    });

  function toggle(id: number) {
    if (editingId !== null) return;
    setNotice(null);
    setProblem(null);
    setOpenId((o) => (o === id ? null : id));
  }

  function openCreate() {
    setNotice(null);
    setProblem(null);
    setOpenId(null);
    setEditingId(null);
    keyRef.current = newKey();
    draft.current = null;
    setFormKey((k) => k + 1);
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    draft.current = null;
    setProblem(null);
    focusAfter.current = "add";
  }

  const createInitial: FormValues = {
    actionAt: toLocalInput(new Date()),
    description: "",
    responsibleStaffId: String(owners.some((o) => o.id === currentUserId) ? currentUserId : (owners[0]?.id ?? "")),
    followUpRequired: false,
    followUpNote: "",
    attachmentNotes: "",
  };

  function detail(a: ActionItem) {
    if (editingId === a.id) {
      const shownVersion = problem?.stale ?? a;
      return (
        <ActionForm
          key={`edit-${a.id}-${formKey}`}
          idPrefix={`action-edit-${a.id}`}
          mode="edit"
          ticketCreatedAt={ticketCreatedAt}
          initial={valuesOf(a)}
          owners={owners}
          current={a}
          busy={busy}
          problem={problem}
          onSubmit={(values) => void save(a, a.version, values)}
          onCancel={() => {
            setEditingId(null);
            draft.current = null;
            setProblem(null);
            focusAfter.current = a.id;
          }}
          onUseMine={(values) => {
            // Resend what is in the form against the version the server now holds.
            const latest = problem!.stale!;
            actions.replace(latest);
            setProblem(null);
            void save(latest, latest.version, values);
          }}
          draft={draft}
          onDiscardMine={() => {
            actions.replace(shownVersion);
            setProblem(null);
            setEditingId(null);
            draft.current = null;
            focusAfter.current = a.id;
          }}
          onEdited={() => problem?.message && setProblem((p) => (p?.stale ? p : null))}
        />
      );
    }
    return (
      <div>
        <ActionFields a={a} />
        {a.status === "PLANNED" ? (
          workable && (
            <div className="d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-sm btn-outline-secondary zg-touch-target" onClick={() => ((draft.current = null), setProblem(null), setFormKey((k) => k + 1), setEditingId(a.id))}>
                Edit
              </button>
              <button type="button" className="btn btn-sm zg-btn-primary zg-touch-target" onClick={() => (setProblem(null), setDialog({ kind: "complete", id: a.id }))}>
                Complete
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary zg-touch-target" onClick={() => (setProblem(null), setDialog({ kind: "cancel", id: a.id }))}>
                Cancel Action
              </button>
            </div>
          )
        ) : (
          <p className="text-muted small mb-0">This action is final and cannot be changed.</p>
        )}
      </div>
    );
  }

  const dialogAction = dialog ? byId(dialog.id) : null;

  return (
    <div>
      <p className="zg-banner-pale rounded p-2 small mb-3">
        <span aria-hidden="true" className="me-1">
          &#9432;
        </span>
        Actions Taken are visible to the Requester. Use an Internal Note for anything private.
      </p>

      <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
        {workable ? (
          !creating && (
            <button ref={addRef} type="button" className="btn zg-btn-primary zg-touch-target" onClick={openCreate}>
              Add Action
            </button>
          )
        ) : (
          <p className="text-muted mb-0">Actions cannot be added to a Resolved, Closed, or Cancelled ticket. Reopen it to add work.</p>
        )}
      </div>

      {/* "Action added." and the other confirmations are announced politely (ui-spec.md section 13); a
          conflict is an alert. */}
      {notice && (
        <p ref={noticeRef} tabIndex={-1} role={notice.kind === "success" ? "status" : "alert"} className={`small rounded p-2 mb-2 ${notice.kind === "success" ? "zg-banner-pale" : "zg-alert-warning"}`}>
          {notice.text}
        </p>
      )}

      {creating && (
        <ActionForm
          key={`create-${formKey}`}
          idPrefix="action-create"
          mode="create"
          ticketCreatedAt={ticketCreatedAt}
          draft={draft}
          initial={createInitial}
          owners={owners}
          busy={busy}
          problem={problem}
          onSubmit={(values) => void create(values)}
          onCancel={closeCreate}
          // What was typed changed, so the next submission is a different request with a new key (BR-39).
          onEdited={() => {
            keyRef.current = newKey();
            if (problem?.message) setProblem(null);
          }}
        />
      )}

      <ListState actions={actions} emptyText="No actions recorded yet." />
      {actions.state === "ready" && actions.items.length > 0 && <ActionList actions={actions.items} openId={openId} onToggle={toggle} renderDetail={detail} rowRefs={rowRefs} />}

      {dialog?.kind === "complete" && dialogAction && (
        <CompleteDialog action={dialogAction} ticketCreatedAt={ticketCreatedAt} busy={busy} problem={problem} onSubmit={(result, at) => void finish(dialogAction, "complete", result, at)} onClose={() => (setDialog(null), setProblem(null))} />
      )}
      {dialog?.kind === "cancel" && dialogAction && (
        <CancelDialog action={dialogAction} busy={busy} problem={problem} onSubmit={(reason) => void finish(dialogAction, "cancel", reason)} onClose={() => (setDialog(null), setProblem(null))} />
      )}
    </div>
  );
}
