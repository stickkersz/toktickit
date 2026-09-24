import { ReactNode, useRef, useState } from "react";

export interface TabSpec {
  id: string;
  label: string;
  // Shown as "Label (n)". Left off while unknown, never shown as 0.
  count: number | null;
  icon?: ReactNode;
  panelClassName?: string;
  content: ReactNode;
}

// The WAI-ARIA tabs pattern: a tablist of real buttons, arrow keys, Home and End move between tabs
// with the selected one alone in the tab order, and only the selected tab's panel is in the page.
// Nothing that belongs to a hidden tab is rendered, so it cannot be reached, typed into or announced.
export function Tabs({ label, idPrefix, tabs }: { label: string; idPrefix: string; tabs: TabSpec[] }) {
  const [activeId, setActiveId] = useState(tabs[0].id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  function move(to: number) {
    const next = tabs[(to + tabs.length) % tabs.length];
    setActiveId(next.id);
    refs.current[next.id]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowRight") move(index + 1);
    else if (e.key === "ArrowLeft") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  }

  const tabId = (id: string) => `${idPrefix}-tab-${id}`;
  const panelId = (id: string) => `${idPrefix}-panel-${id}`;

  return (
    <div>
      <div role="tablist" aria-label={label} className="zg-tabs nav nav-tabs flex-nowrap">
        {tabs.map((tab, index) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={selected ? panelId(tab.id) : undefined}
              tabIndex={selected ? 0 : -1}
              className={`nav-link zg-tab${selected ? " active" : ""}`}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== null ? ` (${tab.count})` : ""}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId(active.id)}
        aria-labelledby={tabId(active.id)}
        tabIndex={0}
        className={`zg-tabpanel${active.panelClassName ? ` ${active.panelClassName}` : ""}`}
      >
        {active.content}
      </div>
    </div>
  );
}
