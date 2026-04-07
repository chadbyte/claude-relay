var { createTerminal } = require("./terminal");

var MAX_TERMINALS = 10;
var SCROLLBACK_MAX = 50 * 1024; // 50 KB per terminal

/**
 * Create a terminal manager for a project.
 * Manages persistent PTY sessions with scrollback buffering.
 * opts: { cwd, send, sendTo }
 */
function createTerminalManager(opts) {
  var cwd = opts.cwd;
  var send = opts.send;
  var sendTo = opts.sendTo;

  var nextId = 1;
  var terminals = new Map(); // id -> terminal session

  function create(cols, rows, osUserInfo, ownerWs) {
    if (terminals.size >= MAX_TERMINALS) return null;

    var pty = createTerminal(cwd, cols, rows, osUserInfo);
    if (!pty) return null;

    var id = nextId++;
    var session = {
      id: id,
      pty: pty,
      scrollback: [],
      scrollbackSize: 0,
      cols: cols || 80,
      rows: rows || 24,
      title: "Terminal " + id,
      exited: false,
      exitCode: null,
      subscribers: new Set(),
      ownerWs: ownerWs || null,
    };

    pty.onData(function (data) {
      // Buffer scrollback
      session.scrollback.push(data);
      session.scrollbackSize += data.length;
      while (session.scrollbackSize > SCROLLBACK_MAX && session.scrollback.length > 1) {
        session.scrollbackSize -= session.scrollback[0].length;
        session.scrollback.shift();
      }

      // Broadcast to subscribers
      var msg = JSON.stringify({ type: "term_output", id: id, data: data });
      for (var ws of session.subscribers) {
        if (ws.readyState === 1) ws.send(msg);
      }
    });

    pty.onExit(function (e) {
      session.exited = true;
      session.exitCode = e && e.exitCode != null ? e.exitCode : null;
      session.pty = null;

      var msg = JSON.stringify({ type: "term_exited", id: id });
      for (var ws of session.subscribers) {
        if (ws.readyState === 1) ws.send(msg);
      }

      // Broadcast updated list
      send({ type: "term_list", terminals: list() });
    });

    terminals.set(id, session);
    return session;
  }

  function attach(id, ws) {
    var session = terminals.get(id);
    if (!session) return false;

    // Skip scrollback replay if already subscribed (e.g. create then activate)
    var alreadySubscribed = session.subscribers.has(ws);
    session.subscribers.add(ws);

    // Replay scrollback only for newly attached clients
    if (!alreadySubscribed && session.scrollback.length > 0) {
      var replay = session.scrollback.join("");
      sendTo(ws, { type: "term_output", id: id, data: replay });
    }

    // Send current terminal dimensions so the client renders at the correct size
    if (!alreadySubscribed && session.cols && session.rows) {
      sendTo(ws, { type: "term_resized", id: id, cols: session.cols, rows: session.rows });
    }

    // If already exited, notify
    if (session.exited) {
      sendTo(ws, { type: "term_exited", id: id });
    }

    return true;
  }

  function detach(id, ws) {
    var session = terminals.get(id);
    if (!session) return;
    session.subscribers.delete(ws);
  }

  function detachAll(ws) {
    for (var session of terminals.values()) {
      session.subscribers.delete(ws);
    }
  }

  function write(id, data) {
    var session = terminals.get(id);
    if (session && session.pty) {
      session.pty.write(data);
    }
  }

  function resize(id, cols, rows, sourceWs) {
    var session = terminals.get(id);
    if (!session || !session.pty) return;
    // Only the terminal owner can resize the PTY.
    // Observers resizing would cause SIGWINCH and flood the owner with escape sequences.
    if (session.ownerWs && sourceWs && sourceWs !== session.ownerWs) return;
    if (cols > 0 && rows > 0) {
      try {
        session.pty.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
        // Notify other subscribers about the resize so their xterm stays in sync
        var msg = JSON.stringify({ type: "term_resized", id: id, cols: cols, rows: rows });
        for (var ws of session.subscribers) {
          if (ws.readyState === 1 && ws !== sourceWs) ws.send(msg);
        }
      } catch (e) {}
    }
  }

  function close(id) {
    var session = terminals.get(id);
    if (!session) return;

    if (session.pty) {
      try { session.pty.kill(); } catch (e) {}
      session.pty = null;
    }

    // Notify subscribers
    var msg = JSON.stringify({ type: "term_closed", id: id });
    for (var ws of session.subscribers) {
      if (ws.readyState === 1) ws.send(msg);
    }

    terminals.delete(id);

    // Reset counter when all terminals are closed
    if (terminals.size === 0) nextId = 1;
  }

  function rename(id, title) {
    var session = terminals.get(id);
    if (!session) return;
    session.title = String(title).substring(0, 50);
  }

  function list() {
    var result = [];
    for (var session of terminals.values()) {
      result.push({
        id: session.id,
        title: session.title,
        exited: session.exited,
      });
    }
    return result;
  }

  function destroyAll() {
    for (var session of terminals.values()) {
      if (session.pty) {
        try { session.pty.kill(); } catch (e) {}
        session.pty = null;
      }
    }
    terminals.clear();
  }

  return {
    create: create,
    attach: attach,
    detach: detach,
    detachAll: detachAll,
    write: write,
    resize: resize,
    close: close,
    rename: rename,
    list: list,
    destroyAll: destroyAll,
  };
}

module.exports = { createTerminalManager: createTerminalManager };
