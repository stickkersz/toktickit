import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ContentItem, ValidationError } from "./api.js";

// BR-33: 2 to 2000 characters once trimmed. The server decides; this only saves a round trip.
export const CONTENT_MIN = 2;
export const CONTENT_MAX = 2000;
export const CONTENT_RANGE_MESSAGE = `Content must be between ${CONTENT_MIN} and ${CONTENT_MAX} characters.`;
export const TERMINAL_MESSAGE = "This Ticket is closed, so comments can no longer be added.";

export type ContentState = "loading" | "ready" | "error";

export interface ContentThread {
  items: ContentItem[];
  state: ContentState;
  // The count is only known once the list has loaded: an unknown count is left off, never shown as 0.
  count: number | null;
  draft: string;
  setDraft: (value: string) => void;
  posting: boolean;
  problem: string | null;
  retry: () => void;
  post: () => Promise<void>;
}

// One list of Public Comments or Internal Notes for one Ticket, and the box that adds to it. The
// draft lives here, not in the panel, so it survives switching tabs (only the active tab's
// composer is rendered). Nothing loaded or posted for one Ticket can reach another: both screens
// that use this unmount their panels whenever they reload a Ticket, and an answer that arrives for
// an unmounted hook changes nothing.
export function useContentThread(
  ticketId: number,
  fetchList: (ticketId: number) => Promise<ContentItem[]>,
  send: (ticketId: number, body: string) => Promise<ContentItem>,
  noun: string,
): ContentThread {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [state, setState] = useState<ContentState>("loading");
  const [draft, setDraftState] = useState("");
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const postingRef = useRef(false);

  const load = useCallback(() => {
    setState("loading");
    fetchList(ticketId).then(
      (list) => {
        setItems(list);
        setState("ready");
      },
      () => setState("error"),
    );
    // fetchList is a module-level function, stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  useEffect(load, [load]);

  function setDraft(value: string) {
    setDraftState(value);
    setProblem(null);
  }

  async function post() {
    // One request at a time, whatever the button does while it is busy.
    if (postingRef.current) return;
    const text = draft.trim();
    if (text.length < CONTENT_MIN || text.length > CONTENT_MAX) {
      setProblem(CONTENT_RANGE_MESSAGE);
      return;
    }
    postingRef.current = true;
    setPosting(true);
    setProblem(null);
    try {
      const created = await send(ticketId, text);
      setItems((list) => [...list, created]);
      setDraftState("");
    } catch (e) {
      if (e instanceof ValidationError) setProblem(e.fields.body ?? e.message);
      else if (e instanceof ApiError && e.code === "TICKET_TERMINAL") setProblem(TERMINAL_MESSAGE);
      else setProblem(`Unable to add the ${noun}. Nothing was added.`);
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  }

  return { items, state, count: state === "ready" ? items.length : null, draft, setDraft, posting, problem, retry: load, post };
}
