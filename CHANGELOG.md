# Changelog

## WIP

- Support `claude-relay-dev` running independently from production daemon (separate port 2635, config dir `~/.claude-relay-dev/`)
- Add right-click context menu on terminal with Copy Terminal and Clear Terminal actions
- Add RTL (bidi) text support for prompt field and responses (#114)
- Fix duplicate approval prompts appearing when browser tab returns from background (#112)
- Never abort queries on client disconnect — remove auto-abort logic that killed active queries on brief connection drops (#113)
- Debounce "Server Connection Lost" notification by 5 seconds to suppress alerts on brief disconnections (#113)
- Suppress "Server connection restored" notification when disconnection was too brief to notify
- Redirect to dashboard with toast when accessing a removed project instead of showing bare "Not found" page
- Fix Node 18 "Object not disposable" error after Claude Code auto-update by polyfilling `Symbol.dispose` (#116)

## v2.3.0

- Add `--dangerously-skip-permissions` CLI flag to bypass all permission prompts via SDK native `permissionMode` (#100)
  - Requires `--pin` for safety; shows red warning banner in web UI when active
- Fix iOS push notifications not delivered in background (#94)
- Fix notification click opening blank session instead of correct project (#94)
- Fix silent validation pushes showing empty notifications in service worker (#94)
- Fix duplicate done notifications when both browser and push notifications active (#94)
- Fix stale push subscriptions accumulating on PWA reinstall (client sends `replaceEndpoint`)
- Fix share button copying localhost URL instead of LAN/Tailscale address
- Fix setup onboarding showing Tailscale page after selecting LAN-only mode
- Fix dashboard appearing before setup completion for PWA users
- Fix foreground notification suppression on iOS PWA (restore pre-v2.2.0 type-based exceptions)
- Add welcome push notification on push subscribe with confetti
- Auto-hide onboarding banner when push notifications are active
- Restore most recently used session on daemon restart
- Add `/context` command with context window usage panel (#84)
  - Minimizable context panel with inline mini bar (#96)
  - Green/yellow/red color coding for context bar
  - Persist context panel view state across sessions and restarts
  - `/clear` now starts a new session instead of just hiding messages
- Add image lightbox modal with click-to-preview (#82)
- Add auto-focus input on session switch (#98)
- Auto-restart daemon on crash with project recovery and client notification (#101)
- Auto-restart daemon with HTTPS when mkcert is installed but TLS was not active (#90)
- Reload config from disk after setup guide completes (pick up TLS state changes)
- File browser refresh button and auto-refresh on directory changes (#89)
- File history diff viewer with split/unified views, compare bar, and go-to-chat navigation
- Process status panel with `/status` command (#85)
- Auto-cleanup sessions on disconnect and graceful shutdown (#86)
- Rewind mode selection for chat-only, files-only, or both (#43)
- Paste copied file from Finder into chat to insert its path (#81)
- Fix WebSocket 403 when behind reverse proxy with different port (#106)
- Fix lastRewindUuid not persisting across daemon restarts
- Fix context panel token calculation and `/clear` cleanup

## v2.2.4

- Fix Windows IPC failure: use named pipe (`\\.\pipe\claude-relay-daemon`) instead of Unix domain socket
- Fix terminal shell fallback to `cmd.exe`/`COMSPEC` on Windows instead of `/bin/bash`
- Fix browser open using `cmd /c start` on Windows instead of `open`/`xdg-open`
- Fix daemon spawn flashing console window on Windows (`windowsHide`)
- Fix daemon graceful shutdown on Windows via `SIGHUP` listener
- Fix mkcert invocation breaking on paths with spaces (use `execFileSync` with array args)
- Fix file path splitting for Windows backslash paths in push notification titles
- Fix `path.relative` sending backslash paths to browser client
- Show platform-appropriate mkcert install command (choco/apt/brew)
- Hide keep-awake toggle on non-macOS platforms (caffeinate is macOS only)

## v2.2.3

- Fix setup page showing Tailscale onboarding for LAN-only users (#90)
- Add `?mode=lan` query parameter to skip Tailscale step when remote access is not needed
- Always ask "Access from outside?" even when Tailscale is installed
- Generate mkcert certs with all routable IPs (Tailscale + LAN) using whitelist
- Auto-regenerate cert when any routable IP is missing from SAN
- Reorder Android setup: push notifications first, PWA optional with skip
- Add iOS notice that PWA install is required for push notifications

## v2.2.2

- Remove OAuth usage API to comply with Anthropic Consumer ToS (OAuth tokens are now restricted to Claude Code and claude.ai only)
- Replace rate limit bar UI with link to claude.ai/settings/usage
- Remove usage FAB button and header button; usage panel now accessible only via `/usage` slash command

## v2.2.1

- Add `--add`, `--remove`, `--list` CLI flags for non-interactive project management (#75)
- Show active task with spinner in collapsed sticky todo overlay
- Fix sidebar footer Usage button not opening usage panel (pass `toggleUsagePanel` to notifications context)

## v2.2.0

- Add full-text session search with hit timeline (search all message content, highlighted matches in sidebar, rewind-style timeline markers with click-to-navigate and blink)
- Add live-reload file viewer: files update automatically when changed externally via `fs.watch()` (#80)
- Add persistent multi-tab terminal sessions with rename, reorder, and independent scrollback (#76)
- Add usage panel with `/usage` slash command and rate limit progress bars (#66)
- Add model switching UI in header (#67)
- Add plan approval UI: render `ExitPlanMode` as confirmation card with approve/reject (#74)
- Add image attach button with camera and photo library picker for mobile (#48)
- Add send messages while processing (queue input without waiting for completion) (#52)
- Add draft persistence: unsent input saved per session, restored on switch (#60)
- Add compacting indicator when session context is being compacted (#44)
- Add sticky todo overlay: `TodoWrite` tasks float during scroll with collapsed progress bar
- Add copy button to implementation plan cards
- Add special key toolbar for terminal on mobile (Tab, Ctrl+C, arrows) (#58)
- Add newline input support on mobile keyboard (#68)
- Add hold scroll position when user is reading earlier messages (#49)
- UI polish batch: terminal tab badge, tab rename, share button, scrollbar styling, tooltip, usage menu
- Fix Edit tool diff rendering with line numbers, file header, and split view (#73)
- Fix fallback CLI rendering for macOS Terminal.app
- Fix answered AskUserQuestion reverting to pending on page refresh (#79)
- Fix SDK import failures not surfaced to user (#56)
- Fix push notifications firing when PWA is in foreground (#53)
- Fix send/stop button tap target increased to 44px (#50)
- Fix terminal height constrained to visible area above keyboard on mobile (#57)
- Fix stale push subscriptions purged on startup (#51)
- Fix duplicate plan content in plan approval UI
- Fix CLAUDE.md and settings files not loaded in SDK sessions

## v2.1.3

- Fix certificate trust detection on iOS: onboarding page always showed "Certificate not trusted yet" even after installing and trusting the mkcert CA
  - HTTPS `/info` 401 response lacked CORS headers → browser treated as network error → misreported as untrusted cert
  - Switch certificate check fetch to `no-cors` mode so any TLS handshake success = cert trusted

## v2.1.2

- Fix session list reordering on every click (only update order on actual messages, not view switches)
- Fix project switcher losing name/count after incomplete `info` message (defensive caching)
- Remove unselected projects from `~/.clayrc` during restore prompt

## v2.1.0

- **Project persistence via `~/.clayrc`**: project list saved automatically; on daemon restart, CLI prompts to restore previous projects with multi-select
  - Interactive multi-select prompt (space to toggle, `a` for all, esc to skip)
  - Auto-restore all projects when using `--yes` flag
  - Syncs on project add/remove/title change and daemon startup
  - Keeps up to 20 recent projects sorted by last used
- CLI main menu hint redesign: repo link with `s` to star, project tip
- CLI backspace-to-go-back in all select menus
- CLI hotkey system extended to support multiple keys per menu
- Fix current project indicator lost in sidebar dropdown after server restart (slug now sent via WebSocket `info` message)
- Fix `setTitle` info broadcast missing `projectCount` and `projects` fields

## v2.0.5

- Rate limit PIN attempts: 5 failures per IP triggers 15-minute lockout
- PIN page shows remaining attempts and lockout timer
- Add WebSocket Origin header validation (CSRF prevention)
- Gate /info endpoint behind PIN auth, remove path exposure
- Add `--shutdown` CLI flag to stop daemon without interactive menu
- Sidebar redesign: logo + collapse header, project switcher dropdown, session actions (New session, Resume with ID, File browser, Terminal)
- Project switcher: "Projects" as top-level concept, project name below, count badge with accent color
- Project dropdown: indicator dots, session counts, "+ Add project" with onboarding hint
- Remove Sessions/Files tab toggle — File browser now opens as full panel with back button
- Group sessions by date (Today / Yesterday / This Week / Older) based on last interaction
- Session timestamps derived from .jsonl file mtime for accurate ordering

## v2.0.4

- Fix setup flow broken after daemon refactor
  - CORS preflight for HTTP→HTTPS cross-origin setup requests
  - Timing fix: cert/pwa/push init moved into buildSteps() (was running before steps populated)
  - iOS variable shadowing fix (steps array overwritten by DOM element)
- Unify Service Worker scope to root (fix duplicate push notifications per project)
- PWA manifest scope changed to / (one install covers all projects)
- Generate PNG icons for iOS apple-touch-icon support
- Add root-level push API endpoints for setup page
- CLI QR code now always shows HTTP onboarding URL

## v2.0.0

- **Multi-project support**: manage multiple projects on a single server and port
  - Daemon runs in background, survives CLI exit
  - URL routing via `/p/{slug}/` for each project
  - Dashboard page at root (`/`) to browse all projects
  - "All projects" link in sidebar footer menu
- **CLI management overhaul**
  - Restructured menu: Setup notifications, Projects, Settings, Shut down server, Keep server alive & exit
  - Projects sub-menu with add current directory, add by path, project detail, and remove
  - Settings sub-menu with setup notifications, PIN, keep awake toggle, view logs
  - Shut down server moved to main menu for quick access
  - Other CLI instances auto-detect server shutdown and exit gracefully
  - Press `o` hotkey to open browser from main menu
  - Port selection during first-time setup with conflict detection
  - Shutdown confirmation prompt
  - ESC to go back from text prompts with visible hint
  - 2-second feedback messages after adding projects (success/duplicate/error)
- **Project titles**: set custom display names per project (CLI, browser tab, dashboard)
  - `document.title` now shows `ProjectName - Claude Relay` (was `Claude Relay - ProjectName`)
- **Setup notifications fast-path**: skip toggle flow when all prerequisites are already met
- **Keep awake runtime toggle**: enable/disable caffeinate from Settings without restart
- **Urgent attention signals**: favicon blinks and tab title flashes `⚠ Input needed` on permission requests and questions
- **Push notification blocked hint**: show "Blocked by browser" message when push toggle fails
- **File browser**: fix relative image paths in rendered markdown files
- Gradient hint text in main menu
- Add Ctrl+J shortcut to insert newline in input (matches Claude CLI behavior)
- Add QR code button in header to share current URL with click-to-copy

## v1.5.0

- Refactor monolithic codebase into modules
  - app.js 3,258 → 1,090 lines (8 client modules)
  - server.js 2,035 → 704 lines (3 server modules)
  - style.css 3,005 → 7 lines (7 CSS files)
- Push notification titles now show context ("Claude wants to edit auth.ts" instead of just "Edit")
- Auto-resize images >5 MB to JPEG before sending (iPhone screenshots)
- Add mermaid.js diagram rendering with expandable modal viewer and PNG export
- Move TLS certs from per-project to `~/.claude-relay/certs` with auto-migration
- Re-generate certs when current IP is not in SAN
- Add toast notification system and clipboard fallback for HTTP contexts
- Use grayscale mascot for PWA app icon

## v1.4.0

- Pasted content feature: long text (≥500 chars) shows as compact "PASTED" chip with modal viewer on click
- Image previews now render inside the input box (Claude-style)
- Rewindable user messages show "Click to rewind" hint on hover
- Copy resume command moved to session context menu (⋯ button)
- Notification menu: added icons to toggle labels, removed resume button
- Security: shell injection fix (execFileSync), secure cookie flag, session I/O try/catch
- Fix session rename persistence
- Fix sending paste/image-only messages without text

## v1.3.0

- Consolidate notification bell and terminal button into unified settings panel
  - Push notifications toggle (HTTPS only, user-driven subscribe/unsubscribe)
  - Browser alerts and sound toggles
  - Copy resume command integrated into the panel
  - Replace bell icon with sliders icon
- Add web push notifications for response completion, permission requests, questions, errors, and connection changes
  - Rich previews with response text and tool details
  - Subscription persistence with VAPID key rotation handling
  - Auto-resubscribe on VAPID key change
  - Suppress notifications when app is in foreground
- Add multi-step setup wizard with platform detection, PWA install, and push enable
- Add favicon I/O blink during processing
- Replace session delete button with three-dots context menu
  - Rename sessions inline
  - Delete with confirmation
- Replace sidebar footer GitHub link with app menu button
  - Shows current version, GitHub link, and check for updates
  - Manual update check with badge when new version available
- Add rewind feature to restore files and conversation to a previous turn
  - Click any user message to preview rewind with file diffs
  - `/rewind` slash command toggles timeline scrollbar for quick navigation
  - Rewind modal shows changed files with expandable git diffs and line stats
  - File checkpointing and `resumeSessionAt` integration with Claude SDK
  - Works on both active and idle sessions via temporary query
- Add copy button to code blocks
- Add `--debug` flag with debug panel for connection diagnostics
- Fix push notifications failing silently on iOS
- Fix push notification body stuck on previous response content
- Fix AskUserQuestion input staying disabled after switching sessions
- Fix duplicate submit buttons for multi-question prompts

## v1.2.9

- Add automatic port hopping when default port is in use (increments by 2)

## v1.2.8

- Add resume CLI session button to continue terminal conversations in the web UI
- Add notification settings menu with browser alert and sound toggles
- Add skip button and input lock for AskUserQuestion prompts
- Add click-to-copy for assistant messages
- Move sidebar close button to the right side of the header
- Fix AudioContext being recreated on every notification sound

## v1.2.4

- Add collapsible sidebar toggle for desktop (ChatGPT-style)
- Add new version update banner with copy-to-clipboard command
- Add confirmation modal for session deletion
- Add code viewer with line number gutter and syntax highlighting for Read tool results
- Improve tool result blocks to collapse by default with expand chevron

## v1.2.0

- Add auto-update check on startup with `--no-update` flag to opt out
- Add session deletion from the web UI
- Add browser notifications when Claude finishes a response
- Add dynamic page title showing project name and session title
- Add CLI branding with pixel character and dynamic favicon
- Add response fallback for better error handling
- Improve publish script with interactive version bump selection

## v1.1.1

- Add HTTPS support via mkcert with automatic certificate generation
- Add interactive setup flow (accept prompt, PIN protection, keep awake toggle)
- Add permission request UI for tool calls
- Add multi-device session sync
- Add stop button to interrupt Claude processing
- Add QR code display for web UI URL in terminal
- Update README

## v1.0.1

- Initial public release
- WebSocket relay between Claude Code CLI and browser
- Web UI with markdown rendering and streaming responses
- Session management with create, list, resume
- Tailscale IP auto-detection
