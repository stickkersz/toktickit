import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}

describe("authentication secrets", () => {
  // UNIT-10 / AC-60, BR-69
  it("commits no environment file and gives client code no way to read the session", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n");
    expect(tracked.filter((path) => /(^|\/)\.env($|\.)/.test(path) && !path.endsWith(".env.example"))).toEqual([]);

    for (const file of sourceFiles(join(repoRoot, "client/src"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/document\.cookie|toktickit_session|passwordHash|tokenHash/);
    }
  });
});
