# Changelog

## WIP

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
