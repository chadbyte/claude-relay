// Browser MCP Server for Clay
// Provides browser automation tool definitions.
// SDK-free: returns runtime-agnostic tool definitions for YOKE adapter.
//
// Usage:
//   var browserMcp = require("./browser-mcp-server");
//   var toolDefs = browserMcp.getToolDefs(sendExtensionCommandAny, getTabList, contextOps);
//   var mcpConfig = adapter.createToolServer({ name: "clay-browser", version: "1.0.0", tools: toolDefs });

var z;
try { z = require("zod"); } catch (e) { z = null; }

// Build a Zod shape from simple property descriptors
function buildShape(props, required) {
  if (!z) return {};
  var shape = {};
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var p = props[k];
    var field;
    if (p.type === "number") field = z.number();
    else if (p.type === "boolean") field = z.boolean();
    else if (p.enum) field = z.enum(p.enum);
    else field = z.string();
    if (p.description) field = field.describe(p.description);
    if (!required || required.indexOf(k) === -1) field = field.optional();
    shape[k] = field;
  }
  return shape;
}

// Helper: convert positional args (name, desc, schema, handler) to tool definition object
function def(name, description, inputSchema, handler) {
  return { name: name, description: description, inputSchema: inputSchema, handler: handler };
}

function getToolDefs(sendCommand, getTabList, contextOps) {
  // sendCommand(command, args, timeout) -> Promise<result>
  // getTabList() -> array of { id, url, title, favIconUrl }

  // Helper: ensure inject.js loaded (best-effort)
  function ensureInjected(tabId) {
    return sendCommand("tab_inject", { tabId: tabId }).catch(function () {});
  }

  var tools = [];

  // --- browser_list_tabs ---
  tools.push(def(
    "browser_list_tabs",
    "List all open browser tabs with their IDs, URLs, and titles",
    buildShape({}, []),
    function () {
      var tabs = getTabList ? getTabList() : [];
      return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] });
    }
  ));

  // --- browser_open ---
  tools.push(def(
    "browser_open",
    "Open a new browser tab and return its tab ID",
    buildShape({
      url: { type: "string", description: "URL to open" },
      active: { type: "boolean", description: "Activate the tab (default true)" },
    }, ["url"]),
    function (args) {
      return sendCommand("tab_open", { url: args.url, active: args.active !== false }).then(function (result) {
        return { content: [{ type: "text", text: "Opened tab " + (result.id || "unknown") + ": " + args.url }] };
      });
    }
  ));

  // --- browser_close ---
  tools.push(def(
    "browser_close",
    "Close a browser tab",
    buildShape({
      tabId: { type: "number", description: "Tab ID to close" },
    }, ["tabId"]),
    function (args) {
      return sendCommand("tab_close", { tabId: args.tabId }).then(function () {
        return { content: [{ type: "text", text: "Closed tab " + args.tabId }] };
      });
    }
  ));

  // --- browser_navigate ---
  tools.push(def(
    "browser_navigate",
    "Navigate a tab to a new URL",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      url: { type: "string", description: "URL to navigate to" },
    }, ["tabId", "url"]),
    function (args) {
      return sendCommand("tab_navigate", { tabId: args.tabId, url: args.url }).then(function () {
        return { content: [{ type: "text", text: "Navigated tab " + args.tabId + " to " + args.url }] };
      });
    }
  ));

  // --- browser_screenshot ---
  tools.push(def(
    "browser_screenshot",
    "Capture a screenshot of a browser tab. Skip if the tab is already attached as a context source (data is auto-injected).",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector to capture a specific element (optional)" },
    }, ["tabId"]),
    function (args) {
      var extArgs = { tabId: args.tabId };
      if (args.selector) extArgs.selector = args.selector;
      return sendCommand("tab_screenshot", extArgs, 10000).then(function (result) {
        if (!result || !result.image) throw new Error("Screenshot failed");
        return {
          content: [
            { type: "image", data: result.image, mimeType: "image/png" },
            { type: "text", text: "Screenshot captured" + (args.selector ? " (selector: " + args.selector + ")" : " (full viewport)") },
          ],
        };
      });
    }
  ));

  // --- browser_console ---
  tools.push(def(
    "browser_console",
    "Read captured console logs from a tab. Skip if the tab is already a context source (data is auto-injected).",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
    }, ["tabId"]),
    function (args) {
      return ensureInjected(args.tabId).then(function () {
        return sendCommand("tab_console", { tabId: args.tabId });
      }).then(function (result) {
        var logs = [];
        try { logs = typeof result.logs === "string" ? JSON.parse(result.logs) : (result.logs || []); } catch (e) {}
        if (logs.length === 0) return { content: [{ type: "text", text: "No console output captured" }] };
        var lines = logs.map(function (entry) {
          var ts = entry.ts ? new Date(entry.ts).toTimeString().slice(0, 8) : "";
          return "[" + ts + " " + (entry.level || "log").toUpperCase() + "] " + (entry.text || "");
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      });
    }
  ));

  // --- browser_network ---
  tools.push(def(
    "browser_network",
    "Read captured network requests (fetch/XHR) from a tab. Skip if the tab is already a context source.",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
    }, ["tabId"]),
    function (args) {
      return ensureInjected(args.tabId).then(function () {
        return sendCommand("tab_network", { tabId: args.tabId });
      }).then(function (result) {
        var reqs = [];
        try { reqs = typeof result.network === "string" ? JSON.parse(result.network) : (result.network || []); } catch (e) {}
        if (reqs.length === 0) return { content: [{ type: "text", text: "No network requests captured" }] };
        var lines = reqs.map(function (r) {
          var line = (r.method || "GET") + " " + (r.url || "") + " " + (r.status || 0) + " " + (r.duration || 0) + "ms";
          if (r.error) line += " [" + r.error + "]";
          return line;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      });
    }
  ));

  // --- browser_read_page ---
  tools.push(def(
    "browser_read_page",
    "Read page text content (innerText). Skip if the tab is already a context source (text is auto-injected). Use for tabs NOT in context sources, or to read a specific element via selector.",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector to read specific element (optional)" },
    }, ["tabId"]),
    function (args) {
      if (args.selector) {
        var script = "(function() { var el = document.querySelector(" + JSON.stringify(args.selector) + "); if (!el) return ''; var t = el.innerText; return t.length > 32768 ? t.substring(0, 32768) : t; })()";
        return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
          var text = result.value || "";
          if (!text) return { content: [{ type: "text", text: "Element not found or empty: " + args.selector }] };
          return { content: [{ type: "text", text: text }] };
        });
      }
      return sendCommand("tab_page_text", { tabId: args.tabId }).then(function (result) {
        var text = result.text || "";
        if (!text) return { content: [{ type: "text", text: "Page has no text content" }] };
        return { content: [{ type: "text", text: text }] };
      });
    }
  ));

  // --- browser_dom ---
  tools.push(def(
    "browser_dom",
    "Get a simplified DOM tree (tag, id, class, children) for structural analysis",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector for root element (default body)" },
      depth: { type: "number", description: "Max tree depth (default 3)" },
    }, ["tabId"]),
    function (args) {
      var selector = args.selector ? JSON.stringify(args.selector) : '"body"';
      var depth = args.depth || 3;
      var script = "(function() {" +
        "function walk(el, d, max) {" +
        "  if (!el || d > max) return null;" +
        "  var n = { tag: el.tagName.toLowerCase() };" +
        "  if (el.id) n.id = el.id;" +
        "  if (el.className && typeof el.className === 'string') { var c = el.className.trim(); if (c) n.class = c; }" +
        "  if (el.children.length > 0 && d < max) {" +
        "    n.children = [];" +
        "    for (var i = 0; i < el.children.length; i++) {" +
        "      var child = walk(el.children[i], d + 1, max);" +
        "      if (child) n.children.push(child);" +
        "    }" +
        "  } else if (el.children.length > 0) {" +
        "    n.childCount = el.children.length;" +
        "  }" +
        "  if (el.children.length === 0 && el.textContent) {" +
        "    var t = el.textContent.trim();" +
        "    if (t.length > 100) t = t.substring(0, 100) + '...';" +
        "    if (t) n.text = t;" +
        "  }" +
        "  return n;" +
        "}" +
        "var root = document.querySelector(" + selector + ") || document.body;" +
        "return JSON.stringify(walk(root, 0, " + depth + "), null, 2);" +
        "})()";
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
        return { content: [{ type: "text", text: result.value || "null" }] };
      });
    }
  ));

  // --- browser_styles ---
  tools.push(def(
    "browser_styles",
    "Get computed styles of an element (display, position, size, colors, etc.)",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector" },
    }, ["tabId", "selector"]),
    function (args) {
      var script = "(function() {" +
        "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
        "if (!el) return JSON.stringify({ error: 'Element not found' });" +
        "var cs = window.getComputedStyle(el);" +
        "var props = ['display','visibility','opacity','position','top','right','bottom','left'," +
        "'width','height','minWidth','minHeight','maxWidth','maxHeight'," +
        "'margin','padding','border','borderRadius'," +
        "'color','backgroundColor','fontSize','fontFamily','fontWeight'," +
        "'overflow','zIndex','transform','transition','boxShadow','cursor'];" +
        "var result = {};" +
        "for (var i = 0; i < props.length; i++) { result[props[i]] = cs[props[i]]; }" +
        "result.boundingRect = el.getBoundingClientRect().toJSON();" +
        "return JSON.stringify(result, null, 2);" +
        "})()";
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
        return { content: [{ type: "text", text: result.value || "null" }] };
      });
    }
  ));

  // --- browser_storage ---
  tools.push(def(
    "browser_storage",
    "Read browser storage (localStorage, sessionStorage, or cookies)",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      type: { type: "string", enum: ["local", "session", "cookie"], description: "Storage type (default local)" },
    }, ["tabId"]),
    function (args) {
      var storageType = args.type || "local";
      var script;
      if (storageType === "cookie") {
        script = "JSON.stringify(document.cookie.split('; ').reduce(function(o, c) { var p = c.split('='); o[p[0]] = decodeURIComponent(p.slice(1).join('=')); return o; }, {}), null, 2)";
      } else if (storageType === "session") {
        script = "(function() { var o = {}; for (var i = 0; i < sessionStorage.length; i++) { var k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return JSON.stringify(o, null, 2); })()";
      } else {
        script = "(function() { var o = {}; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o, null, 2); })()";
      }
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
        return { content: [{ type: "text", text: result.value || "{}" }] };
      });
    }
  ));

  // --- browser_evaluate ---
  tools.push(def(
    "browser_evaluate",
    "Execute arbitrary JavaScript in the page context and return the result",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      script: { type: "string", description: "JavaScript expression or IIFE to evaluate" },
    }, ["tabId", "script"]),
    function (args) {
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: args.script }).then(function (result) {
        if (result.error) throw new Error(result.error);
        var text = typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
        return { content: [{ type: "text", text: text || "(undefined)" }] };
      });
    }
  ));

  // --- browser_click ---
  tools.push(def(
    "browser_click",
    "Click an element on the page",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector of the element to click" },
    }, ["tabId", "selector"]),
    function (args) {
      var script = "(function() {" +
        "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
        "if (!el) return 'Element not found: " + args.selector.replace(/'/g, "\\'") + "';" +
        "el.scrollIntoView({ block: 'center', behavior: 'instant' });" +
        "el.click();" +
        "return 'Clicked: " + args.selector.replace(/'/g, "\\'") + "';" +
        "})()";
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
        return { content: [{ type: "text", text: result.value || "Click executed" }] };
      });
    }
  ));

  // --- browser_type ---
  tools.push(def(
    "browser_type",
    "Type text into an input element (sets value and dispatches input/change events)",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector of the input element" },
      text: { type: "string", description: "Text to type" },
    }, ["tabId", "selector", "text"]),
    function (args) {
      var script = "(function() {" +
        "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
        "if (!el) return 'Element not found: " + args.selector.replace(/'/g, "\\'") + "';" +
        "el.focus();" +
        "var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');" +
        "if (nativeSetter && nativeSetter.set) { nativeSetter.set.call(el, " + JSON.stringify(args.text) + "); }" +
        "else { el.value = " + JSON.stringify(args.text) + "; }" +
        "el.dispatchEvent(new Event('input', { bubbles: true }));" +
        "el.dispatchEvent(new Event('change', { bubbles: true }));" +
        "return 'Typed into: " + args.selector.replace(/'/g, "\\'") + "';" +
        "})()";
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
        return { content: [{ type: "text", text: result.value || "Type executed" }] };
      });
    }
  ));

  // --- browser_scroll ---
  tools.push(def(
    "browser_scroll",
    "Scroll the page or scroll a specific element into view",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector to scroll into view (optional)" },
      x: { type: "number", description: "Horizontal scroll position (optional)" },
      y: { type: "number", description: "Vertical scroll position (optional)" },
    }, ["tabId"]),
    function (args) {
      var script;
      if (args.selector) {
        script = "(function() {" +
          "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
          "if (!el) return 'Element not found';" +
          "el.scrollIntoView({ block: 'center', behavior: 'smooth' });" +
          "return 'Scrolled to: " + args.selector.replace(/'/g, "\\'") + "';" +
          "})()";
      } else {
        var x = args.x || 0;
        var y = args.y || 0;
        script = "(function() { window.scrollTo(" + x + ", " + y + "); return 'Scrolled to (" + x + ", " + y + ")'; })()";
      }
      return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
        return { content: [{ type: "text", text: result.value || "Scroll executed" }] };
      });
    }
  ));

  // --- browser_wait ---
  tools.push(def(
    "browser_wait",
    "Wait for an element matching a CSS selector to appear in the DOM",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      selector: { type: "string", description: "CSS selector to wait for" },
      timeout: { type: "number", description: "Timeout in ms (default 5000)" },
    }, ["tabId", "selector"]),
    function (args) {
      var timeout = args.timeout || 5000;
      var script = "(function() {" +
        "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
        "if (el) return JSON.stringify({ found: true, tag: el.tagName.toLowerCase() });" +
        "return JSON.stringify({ found: false });" +
        "})()";
      var startTime = Date.now();
      function poll() {
        return sendCommand("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
          var parsed = {};
          try { parsed = JSON.parse(result.value || "{}"); } catch (e) {}
          if (parsed.found) {
            return { content: [{ type: "text", text: "Element found: " + args.selector + " (" + parsed.tag + ")" }] };
          }
          if (Date.now() - startTime >= timeout) {
            throw new Error("Timeout waiting for element: " + args.selector + " (" + timeout + "ms)");
          }
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(poll()); }, 300);
          });
        });
      }
      return poll();
    }
  ));

  // --- browser_wait_navigation ---
  tools.push(def(
    "browser_wait_navigation",
    "Wait for page navigation to complete (URL change + load event)",
    buildShape({
      tabId: { type: "number", description: "Tab ID" },
      timeout: { type: "number", description: "Timeout in ms (default 10000)" },
    }, ["tabId"]),
    function (args) {
      var timeout = args.timeout || 10000;
      return sendCommand("tab_wait_navigation", { tabId: args.tabId, timeout: timeout }, timeout + 3000).then(function (result) {
        if (result.error) throw new Error(result.error);
        return { content: [{ type: "text", text: "Navigation complete: " + (result.url || "unknown URL") }] };
      });
    }
  ));

  // --- browser_watch_tab ---
  if (contextOps && contextOps.watchTab) {
    tools.push(def(
      "browser_watch_tab",
      "Add a browser tab as a persistent context source. Its screenshot and text will be automatically included in every subsequent message.",
      buildShape({
        tabId: { type: "number", description: "Tab ID to watch" },
      }, ["tabId"]),
      function (args) {
        var tabs = getTabList ? getTabList() : [];
        var found = null;
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].id === args.tabId) { found = tabs[i]; break; }
        }
        if (!found) throw new Error("Tab " + args.tabId + " not found in open tabs");
        var active = contextOps.watchTab(args.tabId);
        return Promise.resolve({
          content: [{ type: "text", text: "Now watching tab " + args.tabId + " (" + (found.title || found.url) + "). Its content will be included as context in every message. Active sources: " + active.join(", ") }],
        });
      }
    ));

    tools.push(def(
      "browser_unwatch_tab",
      "Remove a browser tab from persistent context sources. Stops auto-including its content.",
      buildShape({
        tabId: { type: "number", description: "Tab ID to stop watching" },
      }, ["tabId"]),
      function (args) {
        var active = contextOps.unwatchTab(args.tabId);
        return Promise.resolve({
          content: [{ type: "text", text: "Stopped watching tab " + args.tabId + ". Active sources: " + (active.length > 0 ? active.join(", ") : "none") }],
        });
      }
    ));
  }

  return tools;
}

module.exports = { getToolDefs: getToolDefs };
