#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, lstat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface PublisherTokenRecord {
  tokenId: string;
  tokenHash: string;
  publisherId: string;
  team: string;
  permissions: string[];
  expiresAt: string;
  revokedAt?: string;
}

export interface Registry {
  version: 1;
  tokens: PublisherTokenRecord[];
}

const DEFAULT_REGISTRY = "operator/publisher-token-registry.json";
const TEAM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
  return value;
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`missing required option ${label}`);
  return value;
}

function parseExpiry(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("expiration must be a future RFC3339 date-time");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error("expiration must be a future RFC3339 date-time");
  return new Date(timestamp).toISOString();
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function newToken(): { raw: string; id: string; hash: string } {
  const raw = `as_pub_${encodeBase64Url(randomBytes(32))}`;
  const id = `pub_${encodeBase64Url(randomBytes(12))}`;
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  return { raw, id, hash };
}

function isTokenRecord(value: unknown): value is PublisherTokenRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["tokenId", "tokenHash", "publisherId", "team", "permissions", "expiresAt", "revokedAt"]);
  return Object.keys(record).every((key) => allowedKeys.has(key))
    && typeof record.tokenId === "string" && /^pub_[A-Za-z0-9_-]{1,64}$/.test(record.tokenId)
    && typeof record.tokenHash === "string" && /^[a-f0-9]{64}$/.test(record.tokenHash)
    && typeof record.publisherId === "string" && record.publisherId.trim().length > 0
    && typeof record.team === "string" && TEAM_PATTERN.test(record.team)
    && Array.isArray(record.permissions)
    && record.permissions.every((permission) => permission === "artifacts:publish")
    && new Set(record.permissions).size === record.permissions.length
    && typeof record.expiresAt === "string" && Number.isFinite(Date.parse(record.expiresAt))
    && (record.revokedAt === undefined || (typeof record.revokedAt === "string" && Number.isFinite(Date.parse(record.revokedAt))));
}

function isRegistry(value: unknown): value is Registry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const registry = value as Record<string, unknown>;
  if (Object.keys(registry).some((key) => key !== "version" && key !== "tokens")) return false;
  if (registry.version !== 1 || !Array.isArray(registry.tokens) || !registry.tokens.every(isTokenRecord)) return false;
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const entry of registry.tokens) {
    if (ids.has(entry.tokenId) || hashes.has(entry.tokenHash)) return false;
    ids.add(entry.tokenId);
    hashes.add(entry.tokenHash);
  }
  return true;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("registry parent must be a real directory, not a symlink");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("registry parent is not owned by the current user");
  if ((info.mode & 0o077) !== 0) throw new Error("registry parent must not be accessible by group or others");
}

async function readRegistry(path: string): Promise<Registry> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("registry must be a regular file, not a symlink");
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("registry is not owned by the current user");
    if ((info.mode & 0o077) !== 0) throw new Error("registry must not be accessible by group or others");
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRegistry(parsed)) {
      throw new Error("registry file has an unsupported schema");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tokens: [] };
    throw error;
  }
}

async function atomicWrite(path: string, registry: Registry): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  try {
    const current = await lstat(path);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error("registry must be a regular file, not a symlink");
    if (typeof process.getuid === "function" && current.uid !== process.getuid()) throw new Error("registry is not owned by the current user");
    if ((current.mode & 0o077) !== 0) throw new Error("registry must not be accessible by group or others");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temp = `${path}.tmp-${Buffer.from(randomBytes(8)).toString("hex")}`;
  let created = false;
  try {
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    created = false;
    const dirHandle = await open(directory, constants.O_RDONLY);
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } catch (error) {
    if (created) await unlink(temp).catch(() => undefined);
    throw error;
  }
}

function makeRecord(team: string, publisherId: string, expiresAt: string, permissions: string[]): { token: string; record: PublisherTokenRecord } {
  if (!TEAM_PATTERN.test(team)) throw new Error("team must use lowercase letters, digits, hyphens, or underscores");
  if (!publisherId.trim()) throw new Error("publisher ID must not be empty");
  const generated = newToken();
  return {
    token: generated.raw,
    record: {
      tokenId: generated.id,
      tokenHash: generated.hash,
      publisherId,
      team,
      permissions,
      expiresAt,
    },
  };
}

async function withRegistry(path: string, update: (registry: Registry) => { registry: Registry; output?: string }): Promise<string | undefined> {
  const lockPath = `${path}.lock`;
  await ensurePrivateDirectory(dirname(path));
  let lock;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await Bun.sleep(25);
    }
  }
  if (!lock) throw new Error("another token registry update is still running");

  try {
    const registry = await readRegistry(path);
    const result = update(registry);
    await atomicWrite(path, result.registry);
    return result.output;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

export async function runTokenCommand(argv: string[]): Promise<string | undefined> {
  const [command, ...args] = argv;
  if (!["issue", "rotate", "revoke"].includes(command)) {
    throw new Error("usage: bun run apps/gateway/tools/publisher-tokens.ts <issue|rotate|revoke> [options]");
  }
  const path = resolve(option(args, "--registry", DEFAULT_REGISTRY)!);

  return withRegistry(path, (registry) => {
    if (command === "issue") {
      const team = requireValue(option(args, "--team"), "--team");
      const publisherId = requireValue(option(args, "--publisher-id"), "--publisher-id");
      const expiresAt = parseExpiry(requireValue(option(args, "--expires-at"), "--expires-at"));
      const permission = option(args, "--permission", "artifacts:publish")!;
      if (permission !== "artifacts:publish") throw new Error("v1 only supports the artifacts:publish permission");
      if (registry.tokens.some((entry) => entry.publisherId === publisherId && !entry.revokedAt && Date.parse(entry.expiresAt) > Date.now())) {
        throw new Error("this publisher already has an active token; use rotate or assign a distinct publisher ID per device");
      }
      const issued = makeRecord(team, publisherId, expiresAt, [permission]);
      registry.tokens.push(issued.record);
      return { registry, output: `${issued.token}\nToken ID: ${issued.record.tokenId}` };
    }

    const tokenId = requireValue(option(args, "--token-id"), "--token-id");
    const previous = registry.tokens.find((entry) => entry.tokenId === tokenId);
    if (!previous) throw new Error("token ID was not found in the local registry");
    if (previous.revokedAt) throw new Error("token is already revoked");

    if (command === "revoke") {
      previous.revokedAt = new Date().toISOString();
      return { registry, output: `Revoked ${tokenId} in the local registry. Update and activate the Worker secret before considering it revoked on the server.` };
    }

    const expiresAt = parseExpiry(requireValue(option(args, "--expires-at"), "--expires-at"));
    const issued = makeRecord(previous.team, previous.publisherId, expiresAt, previous.permissions);
    previous.revokedAt = new Date().toISOString();
    registry.tokens.push(issued.record);
    return { registry, output: `${issued.token}\nToken ID: ${issued.record.tokenId}\nPrevious token ${tokenId} is revoked in the local registry; deploy the updated registry to activate rotation.` };
  });
}

if (import.meta.main) {
  try {
    const output = await runTokenCommand(Bun.argv.slice(2));
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "token command failed"}\n`);
    process.exitCode = 1;
  }
}
