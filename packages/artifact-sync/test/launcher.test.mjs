import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const launcher = require("../bin/artifact-sync.js");

function childThatExits(code, signal = null) {
  const child = new EventEmitter();
  child.kill = () => {
    child.killed = true;
  };
  process.nextTick(() => child.emit("exit", code, signal));
  return child;
}

test("maps supported platforms to binary names", () => {
  assert.equal(launcher.targetName("linux", "x64"), "artifact-sync-linux-x64");
  assert.equal(launcher.targetName("linux", "arm64"), undefined);
  assert.equal(launcher.targetName("darwin", "x64"), undefined);
  assert.equal(launcher.targetName("darwin", "arm64"), undefined);
  assert.equal(launcher.targetName("win32", "x64"), undefined);
});

test("passes stdin through the real launcher", async () => {
  const filename = launcher.targetName(process.platform, process.arch);
  if (filename === undefined) {
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "artifact-sync-launcher-"));
  try {
    await mkdir(path.join(root, "bin"), { recursive: true });
    await mkdir(path.join(root, "vendor"), { recursive: true });
    await copyFile(
      new URL("../bin/artifact-sync.js", import.meta.url),
      path.join(root, "bin", "artifact-sync.js")
    );
    const binaryPath = path.join(root, "vendor", filename);
    await writeFile(
      binaryPath,
      '#!/usr/bin/env node\nconst fs = require("node:fs");\nprocess.stdout.write(JSON.stringify({ args: process.argv.slice(2), stdin: fs.readFileSync(0, "utf8") }));\n',
      { mode: 0o755 }
    );
    await chmod(binaryPath, 0o755);

    const result = spawnSync(
      process.execPath,
      [path.join(root, "bin", "artifact-sync.js"), "login", "--token-stdin"],
      { input: "token-from-stdin", encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["login", "--token-stdin"],
      stdin: "token-from-stdin"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("forwards arguments and stdio to the selected binary", async () => {
  let invocation;
  const code = await launcher.run({
    platform: "linux",
    arch: "x64",
    vendorDirectory: "/tmp/artifact-sync-test",
    argv: ["daemon", "--config", "/tmp/config.json"],
    fileExists: () => true,
    spawnProcess: (binary, args, options) => {
      invocation = { binary, args, options };
      return childThatExits(0);
    },
    forwardSignals: false
  });

  assert.equal(code, 0);
  assert.deepEqual(invocation.args, ["daemon", "--config", "/tmp/config.json"]);
  assert.deepEqual(invocation.options, { stdio: "inherit" });
  assert.match(invocation.binary, /artifact-sync-linux-x64$/);
});

test("propagates a non-zero binary exit code", async () => {
  const code = await launcher.run({
    platform: "linux",
    arch: "x64",
    fileExists: () => true,
    spawnProcess: () => childThatExits(23),
    forwardSignals: false
  });

  assert.equal(code, 23);
});

test("reports unsupported platforms", async () => {
  const errors = [];
  const code = await launcher.run({
    platform: "win32",
    arch: "x64",
    stderr: (message) => errors.push(message),
    forwardSignals: false
  });

  assert.equal(code, 1);
  assert.match(errors[0], /unsupported on win32-x64/);
});

test("reports a missing binary", async () => {
  const errors = [];
  const code = await launcher.run({
    platform: "linux",
    arch: "x64",
    fileExists: () => false,
    stderr: (message) => errors.push(message),
    forwardSignals: false
  });

  assert.equal(code, 1);
  assert.match(errors[0], /could not find its linux-x64 binary/);
});
