import type { RuntimeProfile, RuntimeProfileInput } from "./runtime-profile.js";

export interface RuntimeProfilePolicy {
  environment: string;
  isAdmin: boolean;
  canModify: boolean;
  canUseDangerFullAccess: boolean;
  canUseCodexHomeOverride: boolean;
}

export function getRuntimeProfilePolicy(input: {
  environment: string;
  adminTokenConfigured: boolean;
  isAdmin: boolean;
}): RuntimeProfilePolicy {
  const isProduction = input.environment === "production";
  const canModify = !isProduction || !input.adminTokenConfigured || input.isAdmin;
  return {
    environment: input.environment,
    isAdmin: input.isAdmin,
    canModify,
    canUseDangerFullAccess: !isProduction || input.isAdmin,
    canUseCodexHomeOverride: !isProduction || input.isAdmin
  };
}

export function validateRuntimeProfileInput(
  input: Partial<RuntimeProfileInput>,
  policy: RuntimeProfilePolicy
): { ok: true } | { ok: false; code: string; message: string } {
  if (!policy.canModify) {
    return {
      ok: false,
      code: "runtime_profile_admin_required",
      message: "Runtime profile modification requires backend admin authorization."
    };
  }
  if (input.sandboxMode === "danger-full-access" && !policy.canUseDangerFullAccess) {
    return {
      ok: false,
      code: "danger_full_access_disabled",
      message: "danger-full-access is disabled for runtime profiles in production."
    };
  }
  if (input.codexHomeOverride && !policy.canUseCodexHomeOverride) {
    return {
      ok: false,
      code: "codex_home_override_admin_required",
      message: "CODEX_HOME override is only available to dev or admin callers."
    };
  }
  return { ok: true };
}

export function redactRuntimeProfileForPolicy(profile: RuntimeProfile, policy: RuntimeProfilePolicy): RuntimeProfile {
  return {
    ...profile,
    codexHomeOverride: policy.canUseCodexHomeOverride ? profile.codexHomeOverride : null
  };
}
