#!/usr/bin/env node
// Apply or revert the locally built OpenCode desktop renderer patch.
//
// Usage:
//   node apply-desktop-patch.mjs --check
//   node apply-desktop-patch.mjs
//   node apply-desktop-patch.mjs --revert
//   node apply-desktop-patch.mjs --resources <path> [--ignore-running]
//   node apply-desktop-patch.mjs --revert --backup <path>
//
// The script never starts OpenCode. Close the app completely before applying
// or reverting, then start it yourself afterwards.
//
// Notes:
// - Only app.asar is replaced. app.asar.unpacked and its native payload stay
//   untouched; the script verifies that every unpacked entry referenced by the
//   archive still exists before swapping.
// - The installed archive is backed up to patch/backup/ before it is replaced.
// - Every copy is SHA-256 verified before and after the swap. If the swap
//   fails, the previous archive is restored and the script exits non-zero.
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.dirname(fileURLToPath(import.meta.url))
const asar = require(
  path.join(root, "opencode/node_modules/.bun/@electron+asar@3.4.1/node_modules/@electron/asar"),
)

const args = process.argv.slice(2)
const known = new Set(["--check", "--revert", "--force", "--ignore-running", "--backup", "--resources"])

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (!known.has(arg)) throw new Error(`Unknown argument: ${arg}`)
  if (arg === "--backup" || arg === "--resources") {
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${arg} needs a value`)
    index += 1
  }
}

function has(flag) {
  return args.includes(flag)
}

function option(flag) {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
  })
}

async function verifyFile(file, expected, label) {
  const stat = fs.statSync(file)
  if (expected.bytes !== undefined) {
    assert(stat.size === expected.bytes, `${label}: expected ${expected.bytes} bytes, found ${stat.size}`)
  }
  const digest = await hashFile(file)
  assert(digest === expected.sha256, `${label}: sha256 ${digest} does not match ${expected.sha256}`)
  return digest
}

function defaultResources() {
  if (process.platform !== "win32") throw new Error("This script targets the Windows desktop install")
  assert(process.env.LOCALAPPDATA, "LOCALAPPDATA is not set")
  return path.join(process.env.LOCALAPPDATA, "Programs", "@opencodedesktop", "resources")
}

function runningProcesses(resources) {
  if (process.platform !== "win32") return []

  const install = path.dirname(resources)
  const escaped = install.replace(/'/g, "''")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Get-Process -Name OpenCode -ErrorAction SilentlyContinue |",
    `  Where-Object { $_.Path -and $_.Path.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } |`,
    "  Select-Object -ExpandProperty Id",
    // Get-Process exits 1 when no process matches, even with the error
    // suppressed. An empty result is a successful query, not a failure.
    "exit 0",
  ].join("\n")

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { encoding: "utf8" },
  )

  if (result.error || result.status !== 0) return null
  return result.stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function unpackedEntries(header) {
  const result = []

  function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const relative = prefix ? `${prefix}/${name}` : name
      if (entry.files) {
        if (entry.unpacked) result.push({ relative, directory: true })
        walk(entry, relative)
        continue
      }
      if (entry.unpacked) result.push({ relative, directory: false })
    }
  }

  walk(header, "")
  return result
}

function checkUnpacked(archive, unpackedDir) {
  const entries = unpackedEntries(asar.getRawHeader(archive).header)
  assert(entries.length > 0, "Archive does not reference app.asar.unpacked")

  for (const entry of entries) {
    const target = path.join(unpackedDir, ...entry.relative.split("/"))
    const stat = fs.existsSync(target) ? fs.statSync(target) : null
    assert(stat, `Missing unpacked payload: ${entry.relative}`)
    assert(
      entry.directory ? stat.isDirectory() : stat.isFile(),
      `Unexpected unpacked payload type: ${entry.relative}`,
    )
  }

  return entries.length
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString("en-US")} bytes`
}

async function describeState(target, manifest) {
  const bytes = fs.statSync(target).size
  const digest = await hashFile(target)
  const state =
    digest === manifest.patched.sha256
      ? "patched"
      : digest === manifest.original.sha256
        ? "original"
        : "unknown"
  return { bytes, digest, state }
}

async function installArchive({ target, resources, source, expected, label }) {
  const temp = path.join(resources, `app.asar.swap-${process.pid}.tmp`)
  const previous = path.join(resources, "app.asar.pre-patch")

  assert(!fs.existsSync(previous), `A previous swap left ${previous}. Restore or remove it before retrying; nothing was changed.`)
  assert(!fs.existsSync(temp), `Stale temporary file exists: ${temp}`)

  try {
    fs.copyFileSync(source, temp)
    await verifyFile(temp, expected, `${label} staging copy`)

    try {
      fs.renameSync(target, previous)
    } catch (error) {
      const codes = new Set(["EPERM", "EACCES", "EBUSY"])
      if (codes.has(error.code)) {
        throw new Error(
          `Cannot replace ${target} (${error.code}). Close OpenCode completely, then run this script again. Nothing was changed.`,
        )
      }
      throw error
    }

    try {
      fs.renameSync(temp, target)
    } catch (error) {
      fs.renameSync(previous, target)
      throw error
    }

    try {
      await verifyFile(target, expected, `${label} installed archive`)
    } catch (error) {
      fs.rmSync(target, { force: true })
      fs.renameSync(previous, target)
      throw error
    }

    fs.rmSync(previous, { force: true })
  } finally {
    fs.rmSync(temp, { force: true })
  }

  console.log(`Installed ${label}: ${target}`)
  console.log(`  ${formatBytes(expected.bytes)}, sha256 ${expected.sha256}`)
  console.log(`  ${checkUnpacked(target, path.join(resources, "app.asar.unpacked"))} unpacked payload entries verified`)
}

const manifestPath = path.join(root, "patch", "manifest.json")
const patchPath = path.join(root, "patch", "app.asar.patched")
const backupDir = path.join(root, "patch", "backup")

assert(fs.existsSync(manifestPath), `Missing manifest: ${manifestPath}. Run patch-desktop-app.mjs first.`)
assert(fs.existsSync(patchPath), `Missing patched archive: ${patchPath}. Run patch-desktop-app.mjs first.`)

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const resources = path.resolve(option("--resources") ?? defaultResources())
const defaultDir = path.resolve(defaultResources())
const isDefaultInstall = resources.toLowerCase() === defaultDir.toLowerCase()
const target = path.join(resources, "app.asar")
const unpackedDir = path.join(resources, "app.asar.unpacked")
const patchRelative = path.relative(root, patchPath)

assert(fs.existsSync(resources), `Missing resources directory: ${resources}`)
assert(fs.existsSync(target), `Missing installed archive: ${target}`)
assert(fs.existsSync(unpackedDir), `Missing unpacked directory: ${unpackedDir}`)

if (has("--ignore-running")) {
  assert(
    !isDefaultInstall,
    "--ignore-running is only allowed with a copied --resources directory, never the real install",
  )
}

const processes = runningProcesses(resources)
const processesRunning = Array.isArray(processes) && processes.length > 0

if (has("--check")) {
  const state = await describeState(target, manifest)
  await verifyFile(patchPath, manifest.patched, "patched archive")
  const unpackedCount = checkUnpacked(patchPath, unpackedDir)
  const backups = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter((file) => file.endsWith(".bak")).sort().reverse()
    : []

  console.log(`Resources:   ${resources}`)
  console.log(`Archive:     ${target} (${formatBytes(state.bytes)})`)
  console.log(`State:       ${state.state} (sha256 ${state.digest})`)
  console.log(`Patch:       ${patchRelative} (${formatBytes(manifest.patched.bytes)}, sha256 ${manifest.patched.sha256})`)
  console.log(`Unpacked:    ${unpackedCount} payload entries present`)
  console.log(`Backups:     ${backups.length ? path.join(backupDir, backups[0]) : "none"}`)
  if (processes === null) {
    console.log("Processes:   could not query (PowerShell failed)")
  } else {
    console.log(`Processes:   ${processesRunning ? `OpenCode is running (${processes.join(", ")})` : "no OpenCode processes"}`)
  }
  process.exit(0)
}

if (processes === null) {
  throw new Error("Could not query running OpenCode processes. Use --check to inspect, or close OpenCode and retry.")
}

if (processesRunning && !has("--ignore-running")) {
  throw new Error(
    `OpenCode is still running (PIDs ${processes.join(", ")}). Close the app completely, then run this script again. Nothing was changed.`,
  )
}

if (has("--revert")) {
  const state = await describeState(target, manifest)

  if (state.state === "original") {
    console.log("Installed archive is already the original; nothing to revert.")
    process.exit(0)
  }

  if (state.state !== "patched" && !has("--force")) {
    throw new Error(
      `Installed archive does not match the patched build (sha256 ${state.digest}). Re-run with --force only if you are sure. Nothing was changed.`,
    )
  }

  let backup = option("--backup") ? path.resolve(option("--backup")) : null
  if (!backup) {
    const candidates = fs.existsSync(backupDir)
      ? fs
          .readdirSync(backupDir)
          .filter((file) => file.endsWith(".bak"))
          .map((file) => path.join(backupDir, file))
          .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
      : []
    backup = candidates[0] ?? null
  }

  assert(backup, `No backup found in ${backupDir}. Pass --backup <path>.`)
  assert(fs.existsSync(backup), `Missing backup: ${backup}`)

  if (!has("--force")) {
    await verifyFile(backup, manifest.original, "backup")
  }

  checkUnpacked(backup, unpackedDir)

  console.log(`Reverting from: ${backup}`)
  await installArchive({
    target,
    resources,
    source: backup,
    expected: { bytes: fs.statSync(backup).size, sha256: await hashFile(backup) },
    label: "original archive",
  })
  console.log("Reverted. Start OpenCode yourself when ready.")
  process.exit(0)
}

const state = await describeState(target, manifest)

if (state.state === "patched") {
  console.log("Installed archive already matches the patch; nothing to do.")
  console.log(`  ${formatBytes(state.bytes)}, sha256 ${state.digest}`)
  console.log(`  ${checkUnpacked(target, unpackedDir)} unpacked payload entries verified`)
  process.exit(0)
}

if (state.state !== "original" && !has("--force")) {
  throw new Error(
    `Installed archive is neither the original 2.1.4 archive nor the patch (sha256 ${state.digest}). It may have been updated. Regenerate the patch instead of forcing. Nothing was changed.`,
  )
}

await verifyFile(patchPath, manifest.patched, "patched archive")
checkUnpacked(patchPath, unpackedDir)

fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const backup = path.join(backupDir, `app.asar.2.1.4-original-${stamp}.bak`)

console.log(`Backing up ${target}`)
console.log(`  -> ${backup}`)
fs.copyFileSync(target, backup)
try {
  await verifyFile(backup, { bytes: state.bytes, sha256: state.digest }, "backup")
} catch (error) {
  fs.rmSync(backup, { force: true })
  throw error
}

await installArchive({
  target,
  resources,
  source: patchPath,
  expected: manifest.patched,
  label: "patched archive",
})

console.log("")
console.log("Apply complete. app.asar.unpacked was not modified.")
console.log("Start OpenCode yourself and verify drag-to-project on the Home screen.")
