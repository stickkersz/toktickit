import { useEffect, type RefObject } from "react";

// Lab 4 FR-17, carried from the #84 sweep: a control that removes itself (Claim, Retry, Clear filters, a
// confirmation, Reload, Remove, Set password) must not drop keyboard focus onto the page. Browsers fire no
// event when they remove the focused element, so this watches the page instead: when the last focused
// element has left it and nothing else holds focus, focus moves to the heading of the nearest region still
// on screen (a dialog, a tab panel, a section, a form, or the page itself). Screens that know a better
// place, such as the control a confirmation acted on, move focus there first; this only catches the rest.
const REGION = '[role="dialog"], [role="tabpanel"], section, form, main';
const HEADING = "h1, h2, h3, h4, h5, h6, legend";

export function useFocusNet(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const current = root.current;
    if (!current) return;
    const host: HTMLElement = current;
    let last: HTMLElement | null = null;
    let regions: HTMLElement[] = [];

    function onFocusIn(e: FocusEvent) {
      last = e.target as HTMLElement;
      regions = [];
      for (let el = last.parentElement; el; el = el.parentElement) if (el.matches(REGION)) regions.push(el);
    }
    function rescue() {
      if (!last || last.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const region = regions.find((el) => el.isConnected) ?? host;
      const target = region.querySelector<HTMLElement>(HEADING) ?? region;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      last = null;
      target.focus();
    }
    // One task later, so a screen's own effect that places focus runs first and this sees the result.
    const observer = new MutationObserver(() => setTimeout(rescue, 0));
    host.addEventListener("focusin", onFocusIn);
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      host.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, [root]);
}
