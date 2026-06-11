import { isAbsolute, posix, relative, resolve, win32 } from "node:path";

export type ProjectPathValidationReason =
  | "allowed"
  | "not_absolute"
  | "contains_parent_segment"
  | "outside_allowlist"
  | "allowlist_empty";

export interface ProjectPathValidationResult {
  ok: boolean;
  normalizedPath: string | null;
  reason: ProjectPathValidationReason;
  diagnostics: {
    requestedPath: string;
    normalizedPath: string | null;
    allowlist: string[];
    matchedWorkspace: string | null;
    reason: ProjectPathValidationReason;
  };
}

export function validateProjectPath(projectPath: string, allowlist: string[]): ProjectPathValidationResult {
  const requestedPath = projectPath.trim();
  const normalizedAllowlist = allowlist.map(normalizeAbsolutePath).filter(Boolean);
  const baseDiagnostics = {
    requestedPath,
    normalizedPath: null as string | null,
    allowlist: normalizedAllowlist,
    matchedWorkspace: null as string | null
  };

  if (!normalizedAllowlist.length) {
    return fail("allowlist_empty", baseDiagnostics);
  }
  if (!isAbsolute(requestedPath)) {
    return fail("not_absolute", baseDiagnostics);
  }
  if (containsParentSegment(requestedPath)) {
    return fail("contains_parent_segment", baseDiagnostics);
  }

  const normalizedPath = normalizeAbsolutePath(requestedPath);
  const matchedWorkspace = normalizedAllowlist.find((workspace) => isInsideOrEqual(normalizedPath, workspace)) ?? null;
  if (!matchedWorkspace) {
    return fail("outside_allowlist", { ...baseDiagnostics, normalizedPath });
  }

  return {
    ok: true,
    normalizedPath,
    reason: "allowed",
    diagnostics: {
      ...baseDiagnostics,
      normalizedPath,
      matchedWorkspace,
      reason: "allowed"
    }
  };
}

export function parseProjectPathAllowlist(value: string, fallbackPath: string): string[] {
  const explicit = value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return explicit.length ? explicit : [fallbackPath];
}

function fail(
  reason: Exclude<ProjectPathValidationReason, "allowed">,
  diagnostics: Omit<ProjectPathValidationResult["diagnostics"], "reason">
): ProjectPathValidationResult {
  return {
    ok: false,
    normalizedPath: diagnostics.normalizedPath,
    reason,
    diagnostics: {
      ...diagnostics,
      reason
    }
  };
}

function containsParentSegment(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}

function isInsideOrEqual(targetPath: string, workspace: string): boolean {
  if (usesPosixAbsolutePath(targetPath) || usesPosixAbsolutePath(workspace)) {
    const normalizedWorkspace = workspace.endsWith("/") ? workspace : `${workspace}/`;
    return targetPath === workspace || targetPath.startsWith(normalizedWorkspace);
  }
  const rel = relative(workspace, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeAbsolutePath(value: string): string {
  if (usesPosixAbsolutePath(value)) {
    return posix.normalize(value);
  }
  return win32.isAbsolute(value) ? win32.normalize(value) : resolve(value);
}

function usesPosixAbsolutePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}
