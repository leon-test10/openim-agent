import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexRuntimeHome } from "../../src/core/codex-runtime-home.service.js";
import type { AppConfig } from "../../src/config/env.js";
import type { CodexSessionRecord } from "../../src/core/session-binding.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-home-"));
  tempDirs.push(dir);
  return dir;
}

function config(baseHome: string): AppConfig {
  return {
    PORT: 8787,
    OPENIM_API_BASE_URL: "http://127.0.0.1:10002",
    OPENIM_ADMIN_USER_ID: "imAdmin",
    OPENIM_ADMIN_SECRET: "",
    OPENIM_ADMIN_TOKEN: "",
    OPENIM_BOT_USER_ID: "codex_bot",
    CODEX_BIN: "codex",
    CODEX_DEFAULT_PROJECT_PATH: "/workspace/demo",
    CODEX_DEFAULT_MODEL: "",
    CODEX_EXEC_TIMEOUT_MS: 600000,
    CODEX_SESSION_HOME_ROOT: "./data/codex-homes",
    CODEX_SESSION_HOME_MODE: "per-session",
    CODEX_SESSION_HOME_SEED_MODE: "copy-auth-only",
    CODEX_BASE_HOME: baseHome,
    CODEX_SANDBOX_MODE: "",
    DATABASE_URL: "file:./data/test.sqlite",
    LOG_LEVEL: "silent"
  };
}

function session(homeDir: string, seedMode: CodexSessionRecord["codexHomeSeedMode"]): CodexSessionRecord {
  return {
    id: "csr_1",
    openimConversationId: "single:codex_bot:user_1",
    openimDisplayUserId: "user_1",
    codexSessionId: null,
    codexProjectPath: "/workspace/demo",
    codexHomeDir: homeDir,
    codexHomeSeedMode: seedMode,
    sandboxMode: null,
    isActive: true,
    status: "active",
    parentSessionRecordId: null,
    forkedFromCodexSessionId: null,
    createdReason: "test",
    createdAt: 1000,
    updatedAt: 1000
  };
}

describe("ensureCodexRuntimeHome", () => {
  it("creates a session CODEX_HOME and copies auth seed files only by default", () => {
    const baseHome = tempDir();
    const targetHome = join(tempDir(), "session-home");
    writeFileSync(join(baseHome, "auth.json"), "{\"token\":\"test\"}", "utf8");
    writeFileSync(join(baseHome, "config.toml"), "sandbox_mode = \"danger-full-access\"", "utf8");

    expect(ensureCodexRuntimeHome(session(targetHome, "copy-auth-only"), config(baseHome))).toBe(targetHome);

    expect(readFileSync(join(targetHome, "auth.json"), "utf8")).toBe("{\"token\":\"test\"}");
    expect(existsSync(join(targetHome, "config.toml"))).toBe(false);
  });

  it("creates an empty session CODEX_HOME when seed mode is none", () => {
    const baseHome = tempDir();
    const targetHome = join(tempDir(), "session-home");
    writeFileSync(join(baseHome, "auth.json"), "{\"token\":\"test\"}", "utf8");

    expect(ensureCodexRuntimeHome(session(targetHome, "none"), config(baseHome))).toBe(targetHome);

    expect(existsSync(targetHome)).toBe(true);
    expect(existsSync(join(targetHome, "auth.json"))).toBe(false);
  });
});
