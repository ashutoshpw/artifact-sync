import { chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const defaultPackageDirectory = path.join(repositoryRoot, "packages", "artifact-sync");
const defaultCargoManifest = path.join(repositoryRoot, "apps", "agent", "Cargo.toml");
const targets = [
  { triple: "x86_64-unknown-linux-gnu", filename: "artifact-sync-linux-x64" }
];

function readCargoPackageVersion(contents) {
  let inPackage = false;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[package]") {
      inPackage = true;
      continue;
    }
    if (inPackage && trimmed.startsWith("[")) {
      break;
    }
    if (inPackage) {
      const match = trimmed.match(/^version\s*=\s*"([^"]+)"/);
      if (match) {
        return match[1];
      }
    }
  }
  throw new Error("Cargo manifest does not contain [package].version");
}

async function copyRequiredFile(source, destination, mode) {
  await copyFile(source, destination);
  if (mode !== undefined) {
    await chmod(destination, mode);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "source-dir": { type: "string", default: "dist/artifacts" },
      "output-dir": { type: "string", default: "dist/npm/artifact-sync" },
      "package-dir": { type: "string", default: defaultPackageDirectory },
      "cargo-manifest": { type: "string", default: defaultCargoManifest }
    }
  });

  const sourceDirectory = path.resolve(values["source-dir"]);
  const outputDirectory = path.resolve(values["output-dir"]);
  const packageDirectory = path.resolve(values["package-dir"]);
  const cargoManifest = path.resolve(values["cargo-manifest"]);

  if (outputDirectory === repositoryRoot || outputDirectory === packageDirectory) {
    throw new Error("output directory must be a separate staging directory");
  }

  const packageJsonPath = path.join(packageDirectory, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const cargoVersion = readCargoPackageVersion(await readFile(cargoManifest, "utf8"));

  if (packageJson.name !== "artifact-sync") {
    throw new Error(`unexpected npm package name: ${packageJson.name}`);
  }
  if (packageJson.private === true) {
    throw new Error("the npm package must not be private");
  }
  if (packageJson.version !== cargoVersion) {
    throw new Error(
      `package version ${packageJson.version} does not match Cargo version ${cargoVersion}`
    );
  }
  if (packageJson.bin?.["artifact-sync"] !== "bin/artifact-sync.js") {
    throw new Error("package must expose artifact-sync through bin/artifact-sync.js");
  }

  const requiredPackageFiles = ["bin/artifact-sync.js", "vendor", "README.md", "LICENSE"];
  if (
    !Array.isArray(packageJson.files) ||
    !requiredPackageFiles.every((file) => packageJson.files.includes(file))
  ) {
    throw new Error("package files must include the launcher, vendor directory, README, and LICENSE");
  }

  const licensePath = path.join(repositoryRoot, "LICENSE");
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(path.join(outputDirectory, "bin"), { recursive: true });
  await mkdir(path.join(outputDirectory, "vendor"), { recursive: true });

  await copyRequiredFile(
    path.join(packageDirectory, "bin", "artifact-sync.js"),
    path.join(outputDirectory, "bin", "artifact-sync.js"),
    0o755
  );
  await copyRequiredFile(
    path.join(packageDirectory, "README.md"),
    path.join(outputDirectory, "README.md")
  );
  await copyRequiredFile(licensePath, path.join(outputDirectory, "LICENSE"));
  await writeFile(
    path.join(outputDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );

  for (const target of targets) {
    const sourcePath = path.join(sourceDirectory, target.triple, "artifact-sync");
    let sourceStat;
    try {
      sourceStat = await lstat(sourcePath);
    } catch {
      throw new Error(`missing release binary: ${sourcePath}`);
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size === 0) {
      throw new Error(`release binary is not a non-empty regular file: ${sourcePath}`);
    }
    await copyRequiredFile(
      sourcePath,
      path.join(outputDirectory, "vendor", target.filename),
      0o755
    );
  }

  console.log(`Prepared ${packageJson.name}@${packageJson.version} in ${outputDirectory}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to prepare npm package: ${message}`);
  process.exitCode = 1;
});
