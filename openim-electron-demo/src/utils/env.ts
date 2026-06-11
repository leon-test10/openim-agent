export function getViteEnv(key: string, fallback = "") {
  const env = import.meta.env as Record<string, unknown>;
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
