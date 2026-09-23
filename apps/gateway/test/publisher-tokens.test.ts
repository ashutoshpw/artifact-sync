import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTokenCommand } from "../tools/publisher-tokens.ts";

const temporaryDirectories: string[] = [];

async function registryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "artifact-token-tool-"));
  temporaryDirectories.push(directory);
  return join(directory, "publisher-token-registry.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("publisher token operator utility", () => {
  it("issues one high-entropy token and stores only its hash", async () => {
    const path = await registryPath();
    const output = await runTokenCommand([
      "issue", "--registry", path, "--team", "w3dev", "--publisher-id", "device-01",
      "--expires-at", "2030-01-01T00:00:00Z", "--permission", "artifacts:publish",
    ]);
    const [tokenLine, tokenIdLine] = output!.split("\n");
    expect(tokenLine).toMatch(/^as_pub_[A-Za-z0-9_-]{43}$/);
    expect(tokenIdLine).toMatch(/^Token ID: pub_/);

    const registry = JSON.parse(await readFile(path, "utf8"));
    expect(registry.tokens).toHaveLength(1);
    expect(registry.tokens[0].tokenHash).toBe(createHash("sha256").update(tokenLine).digest("hex"));
    expect(JSON.stringify(registry)).not.toContain(tokenLine);
    expect(registry.tokens[0]).toMatchObject({ team: "w3dev", publisherId: "device-01", permissions: ["artifacts:publish"] });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rotates and revokes records locally without claiming server activation", async () => {
    const path = await registryPath();
    const issued = await runTokenCommand([
      "issue", "--registry", path, "--team", "w3dev", "--publisher-id", "device-01",
      "--expires-at", "2030-01-01T00:00:00Z",
    ]);
    const oldId = issued!.split("\n")[1].replace("Token ID: ", "");
    const rotated = await runTokenCommand([
      "rotate", "--registry", path, "--token-id", oldId, "--expires-at", "2031-01-01T00:00:00Z",
    ]);
    expect(rotated).toContain("deploy the updated registry");
    const registryAfterRotate = JSON.parse(await readFile(path, "utf8"));
    expect(registryAfterRotate.tokens[0].revokedAt).toBeTruthy();
    expect(registryAfterRotate.tokens).toHaveLength(2);

    const newId = rotated!.split("\n")[1].replace("Token ID: ", "");
    const revoked = await runTokenCommand(["revoke", "--registry", path, "--token-id", newId]);
    expect(revoked).toContain("Update and activate the Worker secret");
    const registryAfterRevoke = JSON.parse(await readFile(path, "utf8"));
    expect(registryAfterRevoke.tokens[1].revokedAt).toBeTruthy();
  });

  it("requires a unique publisher ID per device and serializes concurrent registry updates", async () => {
    const path = await registryPath();
    await runTokenCommand([
      "issue", "--registry", path, "--team", "w3dev", "--publisher-id", "device-01",
      "--expires-at", "2030-01-01T00:00:00Z",
    ]);
    await expect(runTokenCommand([
      "issue", "--registry", path, "--team", "w3dev", "--publisher-id", "device-01",
      "--expires-at", "2030-01-01T00:00:00Z",
    ])).rejects.toThrow("distinct publisher ID per device");

    await Promise.all(Array.from({ length: 12 }, (_, index) => runTokenCommand([
      "issue", "--registry", path, "--team", "w3dev", "--publisher-id", `device-${index + 2}`,
      "--expires-at", "2030-01-01T00:00:00Z",
    ])));
    const registry = JSON.parse(await readFile(path, "utf8"));
    expect(registry.tokens).toHaveLength(13);
    expect(new Set(registry.tokens.map((entry: { tokenId: string }) => entry.tokenId)).size).toBe(13);
  });

  it("rejects a symlinked operator registry", async () => {
    const path = await registryPath();
    const link = `${path}.link`;
    const { symlink } = await import("node:fs/promises");
    await symlink(path, link);
    await expect(runTokenCommand([
      "issue", "--registry", link, "--team", "w3dev", "--publisher-id", "device-01",
      "--expires-at", "2030-01-01T00:00:00Z",
    ])).rejects.toThrow("not a symlink");
  });

  it("refuses registry files that contain a raw token instead of only its hash", async () => {
    const path = await registryPath();
    await Bun.write(path, JSON.stringify({
      version: 1,
      tokens: [{
        tokenId: "pub_fixture",
        tokenHash: "a".repeat(64),
        publisherId: "device-01",
        team: "w3dev",
        permissions: ["artifacts:publish"],
        expiresAt: "2030-01-01T00:00:00Z",
        token: "as_pub_do-not-store-me",
      }],
    }));
    await chmod(path, 0o600);
    await expect(runTokenCommand([
      "issue", "--registry", path, "--team", "w3dev", "--publisher-id", "device-02",
      "--expires-at", "2030-01-01T00:00:00Z",
    ])).rejects.toThrow("unsupported schema");
  });
});
