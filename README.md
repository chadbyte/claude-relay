# claude-relay

<p align="center">
  <img src="media/phone.gif" alt="claude-relay on phone" width="300">
</p>

<h3 align="center">Claude Code on your phone. Push notifications. Zero install.</h3>

[![npm](https://img.shields.io/npm/v/claude-relay)](https://www.npmjs.com/package/claude-relay) [![downloads](https://img.shields.io/npm/dw/claude-relay)](https://www.npmjs.com/package/claude-relay)

You step away. Claude Code stops.

> "A 10-second approval can block it for hours if you're not at your desk."
> — [#25115](https://github.com/anthropics/claude-code/issues/25115)

> "I don't need to write code on my phone. I need to approve, reject, continue, stop. That's it."
> — [#18189](https://github.com/anthropics/claude-code/issues/18189)

**claude-relay fixes this.** Your phone buzzes when Claude needs you. Tap approve. Claude keeps working. You keep doing whatever you were doing.

No app. No cloud. No account. Your code never touches a third-party server.

Runs a Claude Code session on your machine via the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and streams it to your browser over WebSocket. Nothing is proxied through external servers.

---

## Push notifications for Claude Code

Permission request. Task done. Error. Question. Your phone buzzes. Browser can be closed.

Add to home screen → PWA → push notifications work like a native app. Setup wizard handles everything.

<p align="center">
  <img src="media/push-notification.jpg" alt="push notification" width="300">
</p>

## Use Claude Code from any device

Open claude-relay on your phone, tablet, or any browser. Type a prompt, watch Claude work, review code — all in real time. Every connected device sees the same session live.

Permission prompt? Approve from whichever device is closest. The session updates everywhere instantly.

## Quick start

```bash
# Run in your project directory
npx claude-relay

# Scan the QR code with your phone — opens Claude Code in your browser

# Press 's' → setup wizard → push + remote access in 3 steps
```

<p align="center">
  <img src="media/start.gif" alt="npx claude-relay" width="600">
</p>

## All features

- **Push notifications** — permission requests, completions, errors, questions. Works with browser closed.
- **Real-time sync** — every device sees the same session live via WebSocket. Type on desktop, see it on phone.
- **Session persistence** — server restarts, browser crashes, network drops. Session survives. Conversation is never lost.
- **Session handoff** — start in the terminal, pick it up on your phone, hand it back. Seamless.
- **Conversation rewind** — click any previous message to roll back conversation and files together, with full diffs
- **Mobile-first UI** — big approve/deny buttons, one-handed use
- **iPad and tablet support** — full Claude Code from any browser. Your actual machine, your tools, your MCP servers, your files.
- **Setup wizard** — Tailscale, HTTPS, push. Step by step.
- **Multi-session** — multiple projects, automatic port selection
- **PIN protection** — access control beyond network security
- **HTTPS** — automatic certs via mkcert
- **Slash commands** — with autocomplete
- **Zero config** — works with your existing Claude Code setup

## Network access

On the same Wi-Fi? It just works. Open the URL shown in the terminal from any device on your network.

Outside your network? [Tailscale](https://tailscale.com) creates an encrypted tunnel between your devices. No port forwarding. No cloud relay. Your code never leaves your control.

Install on both devices. Same account. Done. claude-relay detects it automatically. Free for personal use.

## HTTPS for push notifications

Push needs HTTPS. [mkcert](https://github.com/FiloSottile/mkcert) makes it painless:

```bash
brew install mkcert
mkcert -install
```

Certificates generate automatically. Setup wizard handles the rest.

## CLI options

```bash
npx claude-relay              # defaults
npx claude-relay -p 8080      # custom port (default: 2633)
npx claude-relay --no-https   # disable HTTPS
npx claude-relay --no-update  # skip update check
npx claude-relay --debug      # debug panel
```

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js 18+
- [mkcert](https://github.com/FiloSottile/mkcert) for HTTPS and push
- [Tailscale](https://tailscale.com) for remote access

## Security

claude-relay only listens on your local network. It is not accessible from the internet unless you explicitly expose it.

Within your network, anyone with the URL and PIN can access your Claude Code session with your user permissions. PIN protection is enabled during setup — every new device must enter the PIN shown in your terminal before connecting.

For remote access, use [Tailscale](https://tailscale.com), WireGuard, or a VPN. Never expose to the public internet.

**Entirely at your own risk.**

## Contributing

Bug fixes and typos — PR welcome. Feature ideas — [open an issue](https://github.com/chadbyte/claude-relay/issues) first. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Independent project. Not affiliated with Anthropic. "Claude" is a trademark of Anthropic.

## License

MIT
