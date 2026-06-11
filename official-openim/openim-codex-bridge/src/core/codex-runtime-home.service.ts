import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AppConfig } from "../config/env.js";
import type { CodexSessionRecord } from "./session-binding.js";

const AUTH_SEED_FILES = ["auth.json", "credentials.json"];
const CONFIG_SEED_FILES = ["config.toml"];

export function ensureCodexRuntimeHome(session: CodexSessionRecord, config: AppConfig): string | undefined {
  if (!session.codexHomeDir) {
    return undefined;
  }

  mkdirSync(session.codexHomeDir, { recursive: true });
  const seedMode = session.codexHomeSeedMode ?? "copy-auth-only";
  if (seedMode === "none") {
    return session.codexHomeDir;
  }

  const baseHome = getBaseCodexHome(config);
  if (!baseHome || !existsSync(baseHome)) {
    return session.codexHomeDir;
  }

  const files = seedMode === "copy-auth-and-config" ? [...AUTH_SEED_FILES, ...CONFIG_SEED_FILES] : AUTH_SEED_FILES;
  for (const file of files) {
    copySeedFileIfPresent(baseHome, session.codexHomeDir, file);
  }

  return session.codexHomeDir;
}

export function getBaseCodexHome(config: AppConfig): string | null {
  if (config.CODEX_BASE_HOME.trim().length > 0) {
    return resolve(config.CODEX_BASE_HOME);
  }

  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim().length > 0) {
    return resolve(process.env.CODEX_HOME);
  }

  const home = homedir();
  return home ? join(home, ".codex") : null;
}

export function listSeedableCodexHomeFiles(config: AppConfig): string[] {
  const baseHome = getBaseCodexHome(config);
  if (!baseHome || !existsSync(baseHome)) {
    return [];
  }

  return readdirSync(baseHome)
    .filter((entry) => {
      const fullPath = join(baseHome, entry);
      return statSync(fullPath).isFile();
    })
    .sort();
}

function copySeedFileIfPresent(baseHome: string, targetHome: string, fileName: string): void {
  const source = join(baseHome, fileName);
  const target = join(targetHome, fileName);
  if (existsSync(source) && !existsSync(target) && statSync(source).isFile()) {
    copyFileSync(source, target);
  }
}
