import http from "node:http";
import { createRequire } from "node:module";
import { app } from "../src/app.js";

// Supertest starts the app on `listen(0)`, which binds every interface on a random port and then talks
// to it as 127.0.0.1. Any other program that has bound 127.0.0.1 on that same port (an editor
// extension's local server, a proxy) then answers instead, and a test sees a stray 404, a foreign JSON
// body, or a hang, about one full run in seven on a machine running such programs.
//
// So the app is served here, once per test file, on 127.0.0.1 itself, where the operating system
// refuses a port someone else already holds, and supertest is pointed at that server. Any other app a
// test builds (the probe apps in helpers.ts) still gets supertest's own behaviour.
const require = createRequire(import.meta.url);
const Test = require("supertest/lib/test.js") as { prototype: { serverAddress: (target: http.Server, path: string) => string } };
const original = Test.prototype.serverAddress;

const server = http.createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
server.unref();
const { port } = server.address() as { port: number };

Test.prototype.serverAddress = function serverAddress(this: unknown, target: http.Server, path: string) {
  if (target.listeners("request")[0] === app) return `http://127.0.0.1:${port}${path}`;
  return original.call(this, target, path);
};
