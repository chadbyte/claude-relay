# Document Viewer: Global Single Instance, Leftmost Dock, Tab Bar — Handoff

## Symptom (screenshot evidence 2026-08-26)

With a Driver|Worker split open, `present_markdown_edit` produced document viewers in multiple places at once: one docked at the far right of the workspace, one covering a chat pane, several open simultaneously. Desired behavior (user-specified):

1. Exactly ONE document viewer globally, no matter which session/pane triggers it.
2. It always docks at the LEFTMOST edge of the workspace.
3. A new `markdown_edit_present` does not replace or close anything: the viewer shows a TAB BAR — each presented document is a tab, a new request adds (or focuses, if the path is already open) a tab, and the newest request gets focus.

## Verified root cause

- Each split pane is a full app instance in an iframe with its own `#file-viewer` (lib/public/modules/split-view.js:198-200); pane-mode CSS (lib/public/css/pane.css:3-46) hides top bar/sidebars/sticky notes but never `#file-viewer` — so a pane's viewer covers that pane's chat.
- The parent window's socket stays anchored to a split member (split-view.js:350-359), and `sendToSession` fans out to every socket with that active session (lib/project.js:364-371) — so one present reaches both the pane iframe and the parent → duplicate viewers.
- `#file-viewer` is a static sibling placed after `#app`/`#split-host` in `#main-panels` (lib/public/index.html:681-700; flex row at lib/public/css/base.css:249-255), which is why it reads as docked right.

## Implementation

### A. Single instance: parent owns the viewer

1. Pane iframes never render the viewer. In lib/public/modules/app-messages.js:1402-1404, when `store.get('paneMode')` is set, forward the message to the parent via a new `clay-pane-present-markdown` postMessage in lib/public/modules/pane-bridge.js (pattern: `reportPaneContext` at :12-24). The parent's split-view message handler (split-view.js:269-280) accepts it and calls the parent's `presentMarkdownEdit`.
2. Belt and braces: add `#file-viewer { display: none !important; }` for pane mode in pane.css (next to the sticky-notes suppression at :22-24).
3. De-dup the anchored-session double delivery: in the parent, ignore WS-delivered `markdown_edit_present` while `store.get('splitPanes')` is set — the pane bridge is the canonical path during a split. (Without a split, the parent's WS delivery is the only path and keeps working.)

### B. Leftmost dock

4. Re-parent/relocate `#file-viewer` to be the FIRST child of `#main-panels` (before `#app` at index.html:403). Static markup move is preferred over runtime re-parenting; check `filebrowser.css:330`'s `:has()` sibling assumption still holds.
5. CSS (lib/public/css/filebrowser.css:957-988): swap `border-left` for `border-right`; verify the <1024px full-screen overlay branch (:990-1002) and the fullscreen variant (:976-987) still behave.
6. Terminal (`#terminal-container`) stays where it is; keep the existing mutual-exclusion convention (terminal.js:195 and filebrowser.js:1100).

### C. Tab bar (model: terminal tabs, terminal.js:191-220 + renderTabBar :526-570)

7. Add a tab strip to the `#file-viewer` header (index.html:682-698). `presentMarkdownEdit` (filebrowser.js:541-550) becomes: ensure panel open → add-or-focus the tab for `msg.path` (path already open → focus + apply the new before-snapshot/change animation) → newest request focused.
8. Per-doc state: refactor the module-global singletons (enumerated in the reset block filebrowser.js:479-499, plus :17, :508-509, :643) into a `docs` map keyed by path: content, before-snapshot, isRendered, history/diff caches, slide state. `showFileContent` (:1033-1140) reads/writes the focused entry. The viewer is read-only today (no dirty state), so no save prompts are needed.
9. Live-follow state (lib/public/modules/markdown-live-edit.js:1-10, 72-108): key `followedPath`/tour timers per document; `#file-viewer-live-status` reflects the focused tab.
10. fs_watch is a single-slot protocol (`sendUnwatch()` takes no path, filebrowser.js:419-429): keep it single-slot — the watch follows the FOCUSED tab (re-watch + refresh content on tab focus). Do not extend the protocol in this PR.
11. Close semantics: the header close button and a per-tab × close the focused/target tab; hide the panel only when the last tab closes (`closeFileViewer` :450-458 adapts). `resetFileBrowser` (:479-505) remains the full teardown and must clear all tabs.

## Hard requirements

- Terminal tab-bar look and feel is the pattern; reuse its CSS approach rather than inventing a new one.
- Non-split behavior (single window, no panes) must keep working end to end, including the change-tour animation on repeated presents of the same file (per-tab before-snapshot retention).
- File-browser-initiated `showFileContent` (clicking files in the tree) participates in the same tab system — no second viewer.
- `var` only, no arrow functions; ESM client modules; state via store.js where it is UI-global (e.g. focused tab), module maps for per-doc caches; English strings; no localStorage; modules under 500 lines — filebrowser.js is already large, so extract the tab management into a new module (e.g. lib/public/modules/filebrowser-tabs.js) and register it in docs/guides/MODULE_MAP.md.
- No server-side protocol changes (the de-dup is client-side; fs_watch stays single-slot).
- Do not commit.

## Tests

DOM/unit harness (pattern: test/worker-proposal-ui.test.js):
1. Two presents with different paths → two tabs, second focused.
2. Present of an already-open path → no new tab, that tab focused.
3. Closing the focused tab focuses a neighbor; closing the last tab hides the panel.
4. Pane-mode message forwarding: in paneMode, presentMarkdownEdit is not rendered locally and the postMessage payload is emitted; parent-side handler adds the tab.
5. Split-active WS de-dup: with splitPanes set, a WS markdown_edit_present is ignored by the parent.

Validation: `node --check` equivalents for ESM (syntax via node --check --input-type=module), full `npm test` green on Node 22 (`/Users/chad/.nvm/versions/node/v22.22.1/bin/node`).

## Acceptance criteria

1. In a split, a present from either pane produces exactly one viewer, docked leftmost in the parent, with the new document focused as a tab.
2. Repeated presents accumulate tabs (same path focuses its existing tab) — nothing is closed or replaced.
3. No viewer ever renders inside a pane iframe.
4. Single-window (no split) behavior unchanged apart from the leftmost dock and tabs.
5. Full suite green.
