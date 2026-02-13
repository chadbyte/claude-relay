# Changelog

## WIP

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
