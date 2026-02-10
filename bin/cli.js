#!/usr/bin/env node

const os = require("os");
const qrcode = require("qrcode-terminal");
const { createServer } = require("../lib/server");

const args = process.argv.slice(2);
let port = 3456;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--port") {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port)) {
      console.error("Invalid port number");
      process.exit(1);
    }
    i++;
  } else if (args[i] === "-h" || args[i] === "--help") {
    console.log("Usage: claude-relay [-p|--port <port>]");
    console.log("");
    console.log("Options:");
    console.log("  -p, --port <port>  Port to listen on (default: 3456)");
    process.exit(0);
  }
}

const cwd = process.cwd();

function getLocalIP() {
  const interfaces = os.networkInterfaces();

  // Prefer Tailscale IP
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/^(tailscale|utun)/.test(name)) {
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
          return addr.address;
        }
      }
    }
  }

  // Check all interfaces for Tailscale CGNAT range (100.64.0.0/10)
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
        return addr.address;
      }
    }
  }

  // Fall back to LAN IP
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  return "localhost";
}

function confirm(callback) {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("");
  console.log("  \x1b[1;33m⚠  WARNING — READ BEFORE CONTINUING\x1b[0m");
  console.log("");
  console.log("  claude-relay has \x1b[1mno built-in authentication or encryption.\x1b[0m");
  console.log("  Anyone with access to the URL gets \x1b[1mfull Claude Code access\x1b[0m to");
  console.log("  this machine — reading, writing, and executing files with your");
  console.log("  user permissions.");
  console.log("");
  console.log("  We strongly recommend using a private network layer such as");
  console.log("  Tailscale, WireGuard, or a VPN.");
  console.log("");
  console.log("  If you choose to expose it beyond your private network, that's");
  console.log("  your call. \x1b[1mEntirely at your own risk.\x1b[0m The authors assume no");
  console.log("  responsibility for any damage, data loss, or security incidents.");
  console.log("");

  rl.question("  Do you understand and accept? (type \x1b[1my\x1b[0m to continue): ", (answer) => {
    rl.close();
    if (/^(y|yes)$/i.test(answer.trim())) {
      callback();
    } else {
      console.log("\n  Aborted.\n");
      process.exit(0);
    }
  });
}

function start() {
  const server = createServer(cwd);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  Port ${port} is already in use.`);
      console.error(`  Run with a different port: claude-relay -p <port>`);
      console.error(`  Or kill the existing process: lsof -ti :${port} | xargs kill\n`);
    } else {
      console.error(`\n  Server error: ${err.message}\n`);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    const ip = getLocalIP();
    const url = `http://${ip}:${port}`;
    const project = require("path").basename(cwd);
    console.log("");
    console.log(`  Claude Relay running at ${url}`);
    console.log(`  Project: ${project}`);
    console.log(`  Directory: ${cwd}`);
    console.log("");
    qrcode.generate(url, { small: true }, (code) => {
      console.log(code.replace(/^/gm, "  "));
      console.log("");
      console.log("  Scan the QR code or open the URL on your phone.");
      console.log("");
    });
  });
}

confirm(start);
