#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const supportedTargets = Object.freeze({
  "linux-x64": "artifact-sync-linux-x64"
});

function targetName(platform = process.platform, arch = process.arch) {
  return supportedTargets[`${platform}-${arch}`];
}

function defaultVendorDirectory() {
  return path.join(__dirname, "..", "vendor");
}

function resolveBinary(
  platform = process.platform,
  arch = process.arch,
  vendorDirectory = defaultVendorDirectory()
) {
  const filename = targetName(platform, arch);
  return filename === undefined ? null : path.join(vendorDirectory, filename);
}

function supportedTargetList() {
  return Object.keys(supportedTargets).join(", ");
}

async function run({
  platform = process.platform,
  arch = process.arch,
  argv = process.argv.slice(2),
  vendorDirectory = defaultVendorDirectory(),
  spawnProcess = spawn,
  fileExists = existsSync,
  stderr = (message) => console.error(message),
  forwardSignals = true
} = {}) {
  const binary = resolveBinary(platform, arch, vendorDirectory);
  if (binary === null) {
    stderr(
      `artifact-sync is unsupported on ${platform}-${arch}. Supported targets: ${supportedTargetList()}.`
    );
    return 1;
  }

  if (!fileExists(binary)) {
    stderr(
      `artifact-sync could not find its ${platform}-${arch} binary. Reinstall the package and try again.`
    );
    return 1;
  }

  let child;
  try {
    child = spawnProcess(binary, argv, { stdio: "inherit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`artifact-sync failed to start: ${message}`);
    return 1;
  }

  const signals = process.platform === "win32" ? ["SIGINT", "SIGTERM"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map();
  if (forwardSignals) {
    for (const signal of signals) {
      const handler = () => {
        if (!child.killed) {
          child.kill(signal);
        }
      };
      process.on(signal, handler);
      handlers.set(signal, handler);
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      for (const [signal, handler] of handlers) {
        process.removeListener(signal, handler);
      }
    };

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const message = error instanceof Error ? error.message : String(error);
      stderr(`artifact-sync failed to start: ${message}`);
      resolve(1);
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (signal && forwardSignals) {
        stderr(`artifact-sync terminated by ${signal}.`);
      }
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

if (require.main === module) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`artifact-sync failed: ${message}`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  resolveBinary,
  run,
  supportedTargets,
  targetName
};
