import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const asar = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "opencode/node_modules/.bun/@electron+asar@3.4.1/node_modules/@electron/asar",
  ),
)

const root = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not set")
const resources = path.join(process.env.LOCALAPPDATA, "Programs", "@opencodedesktop", "resources")
const original = path.join(resources, "app.asar")
const source = path.join(root, "opencode/packages/desktop/out/renderer")
const output = path.join(root, "patch")
const build = path.join(output, "build")
const extracted = path.join(build, "app")
const patched = path.join(build, "app.asar.patched")

if (!fs.existsSync(original)) throw new Error(`Missing installed archive: ${original}`)
if (!fs.existsSync(path.join(source, "index.html"))) throw new Error(`Missing built renderer: ${source}`)

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function posix(file) {
  return file.split(path.sep).join("/")
}

function flatten(header) {
  const files = new Map()
  const dirs = new Map()

  function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const file = prefix ? `${prefix}/${name}` : name

      if (entry.files) {
        dirs.set(file, entry)
        walk(entry, file)
        continue
      }

      files.set(file, entry)
    }
  }

  walk(header, "")
  return { files, dirs }
}

function copyRenderer(from, to) {
  fs.mkdirSync(to, { recursive: true })

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name)
    const targetPath = path.join(to, entry.name)

    if (entry.isDirectory()) {
      copyRenderer(sourcePath, targetPath)
      continue
    }

    if (!entry.isFile()) throw new Error(`Unexpected renderer entry: ${sourcePath}`)
    if (entry.name.endsWith(".map")) continue
    fs.copyFileSync(sourcePath, targetPath)
  }
}

function rendererPaths(root) {
  const result = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative)
        continue
      }
      if (!entry.isFile()) throw new Error(`Unexpected renderer entry: ${entry.name}`)
      if (entry.name.endsWith(".map")) continue
      result.push(relative)
    }
  }
  walk(root, "")
  return result.sort()
}

function collect(dir, prefix, streams, unpackedFiles, unpackedDirs) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    const relative = posix(prefix ? path.posix.join(prefix, entry.name) : entry.name)

    if (entry.isDirectory()) {
      streams.push({
        path: relative,
        type: "directory",
        unpacked: unpackedDirs.has(relative),
        stat: fs.statSync(file),
      })
      collect(file, relative, streams, unpackedFiles, unpackedDirs)
      continue
    }

    if (!entry.isFile()) throw new Error(`Unexpected extracted entry: ${file}`)
    streams.push({
      path: relative,
      type: "file",
      unpacked: unpackedFiles.has(relative),
      stat: fs.statSync(file),
      streamGenerator: () => fs.createReadStream(file),
    })
  }
}

function integrity(entry) {
  return entry.integrity?.hash ?? null
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const originalHeader = asar.getRawHeader(original).header
const before = flatten(originalHeader)
const unpackedFiles = new Set([...before.files].filter(([, entry]) => entry.unpacked).map(([file]) => file))
const unpackedDirs = new Set([...before.dirs].filter(([, entry]) => entry.unpacked).map(([file]) => file))

console.log(`Installed archive: ${original}`)
console.log(`Source renderer:   ${source}`)
console.log(`Extracting ${before.files.size} files...`)

fs.rmSync(build, { recursive: true, force: true })
fs.mkdirSync(build, { recursive: true })
asar.extractAll(original, extracted)

const rendererRoot = path.join(extracted, "out", "renderer")
fs.rmSync(rendererRoot, { recursive: true, force: true })
copyRenderer(source, rendererRoot)

const sourceRenderers = rendererPaths(source)
const streams = []
collect(extracted, "", streams, unpackedFiles, unpackedDirs)

console.log(`Packing ${streams.length} entries...`)
const writer = await asar.createPackageFromStreams(patched, streams)
if (!writer.writableFinished) {
  await new Promise((resolve, reject) => {
    writer.once("finish", resolve)
    writer.once("error", reject)
  })
}
fs.rmSync(`${patched}.unpacked`, { recursive: true, force: true })

const afterHeader = asar.getRawHeader(patched).header
const after = flatten(afterHeader)

for (const [file, entry] of before.files) {
  if (file.startsWith("out/renderer/")) continue
  const next = after.files.get(file)
  const extractedFile = path.join(extracted, ...file.split("/"))

  assert(next, `Missing file after patch: ${file}`)
  assert(Boolean(next.unpacked) === Boolean(entry.unpacked), `Unpacked flag changed for ${file}`)
  assert(next.size === fs.statSync(extractedFile).size, `Size changed for ${file}`)

  // Electron-builder signs some unpacked executables after creating the asar header,
  // so the installed header can carry a stale size for those files. Only packed files
  // must round-trip byte-for-byte; unpacked files are compared against their payload.
  if (entry.unpacked) {
    assert(
      integrity(next) === hash(extractedFile),
      `Unpacked payload changed for ${file}: ${integrity(next)} != ${hash(extractedFile)}`,
    )
    continue
  }

  assert(integrity(next) === integrity(entry), `Bytes changed for ${file}`)
}

for (const [dir, entry] of before.dirs) {
  if (dir === "out/renderer" || dir.startsWith("out/renderer/")) continue
  const next = after.dirs.get(dir)

  assert(next, `Missing directory after patch: ${dir}`)
  assert(Boolean(next.unpacked) === Boolean(entry.unpacked), `Unpacked flag changed for directory: ${dir}`)
}

const oldRenderer = new Set([...before.files.keys()].filter((file) => file.startsWith("out/renderer/")))
const oldRendererCount = oldRenderer.size
const newRenderer = new Set([...after.files.keys()].filter((file) => file.startsWith("out/renderer/")))

assert(newRenderer.size === sourceRenderers.length, "Renderer file count does not match the build")
assert([...newRenderer].every((file) => !after.files.get(file).unpacked), "Renderer file was unpacked")

const sourceSet = new Set(sourceRenderers.map((relative) => `out/renderer/${relative}`))
for (const file of oldRenderer) {
  assert(sourceSet.has(file) || !after.files.has(file), `Old renderer file was not replaced: ${file}`)
}

for (const relative of sourceRenderers) {
  const file = `out/renderer/${relative}`
  const entry = after.files.get(file)
  const built = path.join(source, ...relative.split("/"))

  assert(entry, `Missing renderer file after patch: ${relative}`)
  const bytes = asar.extractFile(patched, file.split("/").join(path.sep))
  assert(
    crypto.createHash("sha256").update(bytes).digest("hex") === hash(built),
    `Renderer bytes differ from build: ${relative}`,
  )
}

assert(after.files.size === before.files.size - oldRendererCount + sourceRenderers.length, "Unexpected file count")

const patchedHash = hash(patched)
const originalHash = hash(original)
fs.mkdirSync(output, { recursive: true })
const final = path.join(output, "app.asar.patched")
fs.copyFileSync(patched, final)
fs.rmSync(build, { recursive: true, force: true })

const manifest = {
  createdAt: new Date().toISOString(),
  version: "2.1.4",
  source: "opencode/packages/desktop/out/renderer",
  sourceFiles: sourceRenderers.length,
  original: { path: original, bytes: fs.statSync(original).size, sha256: originalHash },
  patched: { path: final, bytes: fs.statSync(final).size, sha256: patchedHash },
  unpackedFiles: unpackedFiles.size,
  unpackedDirs: unpackedDirs.size,
}
fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Patched archive:   ${final}`)
console.log(`  ${manifest.patched.bytes} bytes, sha256 ${patchedHash}`)
console.log(`  ${sourceRenderers.length} renderer files, ${unpackedFiles.size} unpacked native files preserved`)
console.log(`Manifest:          ${path.join(output, "manifest.json")}`)
