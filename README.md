# claude-relay

Claude Code on your phone with push notifications. One command, zero install.

![claude-relay demo](screenshot.gif)

You start a long task in Claude Code. You step away. Claude needs permission to edit a file. It waits. You come back 30 minutes later to a stalled session.

**claude-relay fixes this.** Run `npx claude-relay` and your phone gets push notifications when Claude needs you. Tap to approve. Claude keeps working. You keep living.

```
npx claude-relay
```

No app to install. No cloud server. No account to create. Your data stays on your machine.

## Use Claude Code from your phone

claude-relay runs on your machine and connects Claude Code to a web UI over WebSocket. Open the URL on your phone, add it to your home screen, and you get push notifications whenever Claude needs input.

Sessions are real-time synced across all connected devices. Type on your PC, see it on your phone. Approve on your phone, see it on your PC. Everything is live.

```
Your phone/tablet  <-->  claude-relay (your machine)  <-->  Claude Code
     browser               WebSocket + HTTPS
```

## Push notifications for Claude Code

Get notified on your phone when Claude needs approval, finishes a task, or hits an error. Works even when the browser is closed. Tap the notification to jump straight in.

No app required. Add to your home screen and notifications work like a native app (PWA). The built-in setup wizard walks you through it in 3 steps.

## Approve Claude Code permissions remotely

Kick off a refactoring task, go make coffee. Your phone buzzes: "Claude wants to edit `src/auth.ts`". Tap approve. Claude continues. No need to walk back to your desk.

Running tests, migrations, or multi-file changes? Watch the progress from your phone or tablet without staying at your desk.

## Claude Code on iPad and tablets

Full Claude Code access from any browser. No SSH terminal app, no GitHub repo required, no sandboxed VM. Your actual dev environment, your tools, your MCP servers, your CLAUDE.md, your files.

## Session handoff between CLI and browser

Start a session in the terminal. Pick it up on your phone. Hand it back to the terminal. Sessions survive server restarts, browser closes, and reconnects. Your conversation is never lost.

## Run Claude Code remotely with Tailscale

To access Claude Code from outside your local network, use [Tailscale](https://tailscale.com). Install it on your machine and your phone, sign in with the same account, and you are connected. claude-relay detects Tailscale automatically.

Tailscale creates a private encrypted tunnel between your devices. No port forwarding, no cloud relay, no data leaving your control.

## Features

- **Push notifications** on permission requests, task completion, and errors
- **Real-time sync** across all connected devices via WebSocket
- **Session persistence** across server restarts and reconnects
- **Mobile-first UI** with big tap targets for approve/deny
- **Setup wizard** guides you through Tailscale, HTTPS, and push setup
- **Multi-session** support with automatic port selection
- **PIN protection** for access control
- **HTTPS** via mkcert, automatic certificate generation
- **Slash commands** with autocomplete
- **Zero config** uses your local Claude Code installation as-is

## Quick start

```bash
# 1. Run in your project directory
npx claude-relay

# 2. Scan the QR code with your phone
#    or open the URL shown in the terminal

# 3. Press 's' for the setup wizard
#    to enable push notifications and remote access
```

## HTTPS setup for push notifications

Push notifications require HTTPS. claude-relay supports automatic HTTPS via [mkcert](https://github.com/FiloSottile/mkcert):

```bash
brew install mkcert
mkcert -install
```

Certificates are generated automatically on first run. The setup wizard checks for mkcert and guides you if it is missing.

## CLI options

```bash
npx claude-relay              # Start with defaults
npx claude-relay -p 8080      # Custom port (default: 2633)
npx claude-relay --no-https   # Disable HTTPS
npx claude-relay --no-update  # Skip auto-update check
npx claude-relay --debug      # Enable debug panel
```

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js 18+
- [mkcert](https://github.com/FiloSottile/mkcert) (for HTTPS and push notifications)
- [Tailscale](https://tailscale.com) (for remote access outside your network)

## Security

**Anyone with access to the URL gets full Claude Code access to your machine**, including reading, writing, and executing files with your user permissions.

Use a private network. We strongly recommend [Tailscale](https://tailscale.com), WireGuard, or a VPN. PIN protection adds a layer of access control but is not a substitute for network-level security. Do not expose claude-relay to the public internet.

**Entirely at your own risk.** The authors assume no responsibility for any damage, data loss, or security incidents.

## Issues

Found a bug or have a feature request? [Open an issue](https://github.com/chadbyte/claude-relay/issues).

## Disclaimer

claude-relay is an independent, unofficial project. It is not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" is a trademark of Anthropic.

## License

MIT
