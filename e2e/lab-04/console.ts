import { expect, test as base, type BrowserContext } from "@playwright/test";

// E2E-09 (AC-44, BR-43): no console error or warning during any Lab 4 journey. Every Lab 4 spec imports
// `test` from here, so each test's browser context is watched and the test fails at its end if anything
// was logged. One kind of message is left out: the browser's own "Failed to load resource: the server
// responded with a status of 4xx" line. It is written for every 4xx response the app asked for and
// handles (the 401 from the session check before sign-in, a 409 conflict a test provokes on purpose), so
// it reports the HTTP status, not a fault in the page. A 5xx is still collected.
const HANDLED_STATUS = /^Failed to load resource: the server responded with a status of 4\d\d/;

export function watchConsole(context: BrowserContext, into: string[]) {
  context.on("console", (msg) => {
    if ((msg.type() === "error" || msg.type() === "warning") && !HANDLED_STATUS.test(msg.text())) into.push(`${msg.type()}: ${msg.text()} (${msg.location().url})`);
  });
  context.on("weberror", (e) => into.push(`uncaught: ${e.error().message}`));
}

export const test = base.extend<{ consoleMessages: string[] }>({
  consoleMessages: [
    async ({ context }, use) => {
      const messages: string[] = [];
      watchConsole(context, messages);
      await use(messages);
      expect(messages, "browser console during this journey (E2E-09)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
