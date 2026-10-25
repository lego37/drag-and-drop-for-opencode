# OpenCode Tweaks — move sessions between projects

A small patch for **OpenCode Desktop 2.1.4** that lets you drag a session from the Home screen onto another project.

The upstream-ready change was extracted into a clean local branch based on `origin/dev`, but it has not been published to a fork yet. Notification sounds are intentionally **not** part of that branch; they are a later, separate proposal.

## What it does

On the Home screen:

- drag a session row and drop it on another project;
- the target project gets a ring while the session is dragged over it;
- the dragged row fades out;
- the move is sent to the server through `session.move`, then a toast confirms it;
- a `session.moved` event updates the client store.

Rules:

- only projects on the **same server** accept the drop — servers are separate session stores;
- the project that already owns the session is not a valid target;
- an unreachable server does not accept drops;
- cancelling a drag (Escape, dropping outside a target) clears the highlight.

Project reordering still uses **dnd-kit**. Only session moves use the native HTML5 drag-and-drop API.

## How it works

### UI

1. `beginHomeSessionDrag` stores the payload in a module-level reference and writes the custom MIME type `application/x-opencode-home-session`.
2. Each project row accepts the drop through `homeSessionDrop`, which checks the server, the current project, and the MIME type.
3. On drop, `onMoveSession` calls the Home sessions controller.
4. The controller syncs the session into the client store, calls `session.move`, and shows the success or failure toast.

The MIME type and module-level reference are used because the source and the targets live in the same window; the full payload never goes through the clipboard or the DOM.

### Server

```http
POST /api/session/:sessionID/move
Content-Type: application/json

{ "directory": "C:/OpenCode/SecondProject" }
```

Response: `204 No Content`, followed by a `session.moved` event.

The sync before the request matters: `session.moved` only patches sessions the client store already holds. Without it, a session that came from the Home index might not refresh.

If the session is running, the server queues the move behind the current step. The toast confirms that the request was accepted; the UI updates when `session.moved` is applied.

The success toast is "Session moved" / "Moved to &lt;project&gt;". On failure, the existing `session.location.moveFailed` string is reused with the server error message.

## Files changed

Paths relative to the OpenCode repository. The clean branch changes 11 files:

| File | Role |
| --- | --- |
| `packages/app/src/home/sessions/drag.ts` | MIME type, transient payload, drop acceptance rules |
| `packages/app/src/home/sessions/view.tsx` | Drag source, opacity while dragging, cleanup on `dragend` |
| `packages/app/src/home/projects/view.tsx` | Per-project drop target, highlight, `onMoveSession` call |
| `packages/app/src/home/projects/region.tsx` | Passes `onMoveSession` through |
| `packages/app/src/home/route.tsx` | Wires `sessions.session.move` for mobile and desktop layouts |
| `packages/app/src/home/sessions/controller.tsx` | Sync, `session.move`, success and failure toasts |
| `packages/app/src/home/projects/view.css` | Drop-target ring |
| `packages/app/src/runtime/i18n/en.ts` | English toast strings |
| `packages/app/e2e/regression/home.spec.ts` | End-to-end coverage of the move |
| `packages/app/e2e/utils/mock-server.ts` | Mock `session.move`, inventory update, `session.moved` event |
| `packages/app/e2e/utils/mock-api.ts` | Mock endpoint declaration |

The new i18n strings are English-only. Other locales fall back to English until they are translated.

## Upstream status

OpenCode requires a feature request and design approval before an implementation PR (`CONTRIBUTING.md`). The code is ready, but **no PR has been opened yet**.

Feature request: [#59049](https://github.com/anomalyco/opencode/issues/59049) — move sessions between projects by dragging them on Home. It is waiting for design approval.

The ability to move a session between projects has been requested before:

- [#24708](https://github.com/anomalyco/opencode/issues/24708) — "move a session", closed as a duplicate of #23249;
- [#23249](https://github.com/anomalyco/opencode/issues/23249) — session migration dialog, closed by the stale bot;
- [#21400](https://github.com/anomalyco/opencode/issues/21400) — move/clone a session into another project, closed by the stale bot.

None of those proposed **drag-and-drop on the Home screen**, and the server-side `session.move` API did not exist when they were closed. The feature request says that explicitly, links to the old issues, and asks for design approval.

Notification sounds are a separate topic. Existing issues:

- [#41355](https://github.com/anomalyco/opencode/issues/41355) — configurable notification/error sounds;
- [#49371](https://github.com/anomalyco/opencode/issues/49371) — sound when the agent asks a question.

Do not open a new generic sound issue.

## Build and install the 2.1.4 patch

> This section is for the local patched desktop build. It is not part of the upstream PR.

### Prerequisites

- Windows 10/11;
- [Bun](https://bun.sh);
- Node.js;
- OpenCode Desktop **2.1.4** installed in the default location:
  `%LOCALAPPDATA%\Programs\@opencodedesktop\resources`.

The scripts target that Windows path. `apply-desktop-patch.mjs` accepts `--resources <dir>` for a moved installation.

### Get the sources

The repository does not track `opencode/`. To rebuild the renderer:

```powershell
git clone https://github.com/sst/opencode
cd opencode
git checkout 68bc26b
git apply ..\patches\opencode-2.1.4.patch
bun install
```

The patch is generated from revision `68bc26b` ("release: v2.1.4").

### Rebuild the renderer

`electron-vite` defaults to the `dev` channel. To match the installed app, force the channel and version:

```powershell
cd opencode/packages/desktop
$env:OPENCODE_CHANNEL = "prod"
$env:OPENCODE_VERSION = "2.1.4"
bun x electron-vite build
```

Output: `opencode/packages/desktop/out/renderer`. Source maps are generated but excluded from the patch.

### Generate the patch

```powershell
# from the repository root
node patch-desktop-app.mjs
```

The script:

1. reads the installed `app.asar`;
2. extracts it;
3. replaces `out/renderer` with the build;
4. repacks the archive and preserves the `unpacked` flags;
5. verifies every non-renderer file is byte-identical;
6. verifies every renderer file matches the build;
7. writes `patch/app.asar.patched` and `patch/manifest.json`.

> Start from the **original** installed archive. If the patch is already applied, restore the original with `--revert` (or reinstall 2.1.4) before regenerating.

### Close OpenCode completely

`close-opencode.ps1` closes every window and `OpenCode.exe` process from the installation, including the tray instance:

```powershell
.\close-opencode.ps1
```

Options: `-GraceSeconds <seconds>`, `-WhatIf`, `-InstallRoot <dir>`.

The script does not touch the background `opencode-cli.exe` service and never restarts the app.

### Apply the patch

```powershell
node apply-desktop-patch.mjs --check
node apply-desktop-patch.mjs
```

`--check` changes nothing. Applying the patch:

1. verifies the installed archive is the 2.1.4 original and the patch matches the manifest;
2. backs up the current archive to `patch/backup/`;
3. copies the patch to a temporary file and verifies its hash;
4. replaces only `app.asar`;
5. verifies the installed archive;
6. restores the previous archive automatically on failure.

`app.asar.unpacked` is never modified. The script checks that every `unpacked` entry referenced by the archive exists before replacing anything.

After the script finishes, **start OpenCode yourself**. It never starts or restarts the app.

### Restore the original archive

```powershell
node apply-desktop-patch.mjs --revert
```

By default it uses the newest backup in `patch/backup/`. To choose another:

```powershell
node apply-desktop-patch.mjs --revert --backup "patch\backup\app.asar.2.1.4-original-<timestamp>.bak"
```

### Options

| Option | Effect |
| --- | --- |
| `--check` | Show state and verify the patch without changing anything |
| `--revert` | Restore an original archive from `patch/backup/` |
| `--backup <file>` | Choose the backup to restore |
| `--resources <dir>` | Target another `resources` directory |
| `--ignore-running` | Skip process detection; only allowed with a non-default `--resources` |
| `--force` | Bypass hash checks; recovery only |

## Verification

Run from `opencode/packages/app` unless noted:

```powershell
# from the repository root
bun run check

# from packages/app
bun typecheck
bun run typecheck:tsc

$env:PLAYWRIGHT_PORT = "4310"
bun run test:e2e:built -- e2e/regression/home.spec.ts --retries=0
```

Results on 25/10/2026 for the clean `session-drag-drop` branch based on `origin/dev`:

| Check | Result |
| --- | --- |
| `bun run check` (root) | 0 errors |
| `bun typecheck` (app) | no type errors |
| `bun run typecheck:tsc` (app) | passed |
| `home.spec.ts` e2e (built) | 12/12 passed |

`bun run typecheck:e2e` still reports pre-existing errors in performance and timeline specs that are unrelated to this change.

## Known limits

- **Desktop first**: HTML5 drag-and-drop is not reliable with touch. The mobile Home layout is not the target.
- **Same server only**: moving across servers is not supported.
- **Same window only**: the payload uses a module-level reference, not the clipboard.
- **English toast** in locales without a translation.
- **Running session**: the server queues the move behind the current step; the toast does not mean the move is already applied.
- **Project reordering** still uses dnd-kit and is independent from this patch.

## Repository layout

- `patches/opencode-2.1.4.patch` — full local patch for OpenCode 2.1.4 (drag-and-drop plus the deferred sound experiment).
- `opencode/` and `patch/` — generated locally and ignored by Git.
- The patch targets OpenCode Desktop **2.1.4**, `prod` channel.
- The real installation is modified only when `apply-desktop-patch.mjs` runs without `--check` or `--revert`.
- Backups in `patch/backup/` must be kept while the app is patched; they are what `--revert` uses.

## Deferred: notification sounds

The 2.1.4 patch also contains an experimental notification-sound layer. It is **not** part of the upstream drag-and-drop PR.

- #41355 covers configurable notification/error sounds.
- #49371 covers a sound when the agent asks a question.
- The local patch now plays the configurable **Questions** sound when a question form is created (`form.created` with `metadata.kind: "question"`) for a session with an open tab. The sound is configured in **Settings > Notifications > Sounds**. This does not close #49371 upstream; the change is local-only.
- Local verification on 25/10/2026: the focused unit tests (24 passed) and the new question-sound e2e check pass; `bun run typecheck` and `bun run typecheck:tsc` are clean.

## French version

[README.fr.md](README.fr.md)
