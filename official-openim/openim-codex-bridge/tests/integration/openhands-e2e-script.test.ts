import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenHands E2E smoke script", () => {
  it("passes its hermetic configuration and redaction self-test", () => {
    const script = resolve(import.meta.dirname, "../../../deploy/windows/smoke-openhands-e2e.ps1");
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-SelfTest"],
      { encoding: "utf8" }
    );

    expect(output).toContain("OpenHands E2E self-test passed.");
    expect(output).not.toContain("self-test-secret");
  }, 15000);
});
