import { PUBLISH_PERMISSION, READ_PERMISSION } from "./types.ts";

export function safePermissions(value: string): string[] {
  try {
    const permissions: unknown = JSON.parse(value);
    return Array.isArray(permissions) && permissions.every((permission) => permission === PUBLISH_PERMISSION || permission === READ_PERMISSION)
      ? permissions
      : [];
  } catch {
    return [];
  }
}
