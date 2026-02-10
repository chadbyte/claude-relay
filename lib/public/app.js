(function() {
  "use strict";

  // --- DOM refs ---
  var $ = function(id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  var statusDot = $("status-dot");
  var statusTextEl = $("status-text");
  var projectNameEl = $("project-name");
  var slashMenu = $("slash-menu");
  var sidebar = $("sidebar");
  var sidebarOverlay = $("sidebar-overlay");
  var sessionListEl = $("session-list");
  var newSessionBtn = $("new-session-btn");
  var hamburgerBtn = $("hamburger-btn");
  var imagePreviewBar = $("image-preview-bar");

  // --- State ---
  var ws = null;
  var connected = false;
  var processing = false;
  var isComposing = false;
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var activityEl = null;
  var currentMsgEl = null;
  var currentFullText = "";
  var tools = {};
  var currentThinking = null;
  var highlightTimer = null;
  var activeSessionId = null;
  var slashCommands = [];
  var slashActiveIdx = -1;
  var slashFiltered = [];
  var pendingImages = []; // [{data: base64, mediaType: "image/png"}]

  var builtinCommands = [
    { name: "clear", desc: "Clear conversation" },
    { name: "cost", desc: "Show session cost" },
  ];

  // --- Lucide icon helper ---
  var _iconTimer = null;
  function refreshIcons() {
    if (_iconTimer) return;
    _iconTimer = requestAnimationFrame(function() {
      _iconTimer = null;
      lucide.createIcons();
    });
  }

  function iconHtml(name, wrapperClass) {
    if (wrapperClass) {
      return '<span class="' + wrapperClass + '"><i data-lucide="' + name + '"></i></span>';
    }
    return '<i data-lucide="' + name + '"></i>';
  }

  // --- Activity verbs ---
  var thinkingVerbs = [
    "Accomplishing","Actioning","Actualizing","Architecting","Baking","Beaming",
    "Beboppin'","Befuddling","Billowing","Blanching","Bloviating","Boogieing",
    "Boondoggling","Booping","Bootstrapping","Brewing","Burrowing","Calculating",
    "Canoodling","Caramelizing","Cascading","Catapulting","Cerebrating","Channeling",
    "Channelling","Choreographing","Churning","Clauding","Coalescing","Cogitating",
    "Combobulating","Composing","Computing","Concocting","Considering","Contemplating",
    "Cooking","Crafting","Creating","Crunching","Crystallizing","Cultivating",
    "Deciphering","Deliberating","Determining","Dilly-dallying","Discombobulating",
    "Doing","Doodling","Drizzling","Ebbing","Effecting","Elucidating","Embellishing",
    "Enchanting","Envisioning","Evaporating","Fermenting","Fiddle-faddling","Finagling",
    "Flambing","Flibbertigibbeting","Flowing","Flummoxing","Fluttering","Forging",
    "Forming","Frolicking","Frosting","Gallivanting","Galloping","Garnishing",
    "Generating","Germinating","Gitifying","Grooving","Gusting","Harmonizing",
    "Hashing","Hatching","Herding","Honking","Hullaballooing","Hyperspacing",
    "Ideating","Imagining","Improvising","Incubating","Inferring","Infusing",
    "Ionizing","Jitterbugging","Julienning","Kneading","Leavening","Levitating",
    "Lollygagging","Manifesting","Marinating","Meandering","Metamorphosing","Misting",
    "Moonwalking","Moseying","Mulling","Mustering","Musing","Nebulizing","Nesting",
    "Newspapering","Noodling","Nucleating","Orbiting","Orchestrating","Osmosing",
    "Perambulating","Percolating","Perusing","Philosophising","Photosynthesizing",
    "Pollinating","Pondering","Pontificating","Pouncing","Precipitating",
    "Prestidigitating","Processing","Proofing","Propagating","Puttering","Puzzling",
    "Quantumizing","Razzle-dazzling","Razzmatazzing","Recombobulating","Reticulating",
    "Roosting","Ruminating","Sauting","Scampering","Schlepping","Scurrying","Seasoning",
    "Shenaniganing","Shimmying","Simmering","Skedaddling","Sketching","Slithering",
    "Smooshing","Sock-hopping","Spelunking","Spinning","Sprouting","Stewing",
    "Sublimating","Swirling","Swooping","Symbioting","Synthesizing","Tempering",
    "Thinking","Thundering","Tinkering","Tomfoolering","Topsy-turvying","Transfiguring",
    "Transmuting","Twisting","Undulating","Unfurling","Unravelling","Vibing","Waddling",
    "Wandering","Warping","Whatchamacalliting","Whirlpooling","Whirring","Whisking",
    "Wibbling","Working","Wrangling","Zesting","Zigzagging"
  ];

  function randomThinkingVerb() {
    return thinkingVerbs[Math.floor(Math.random() * thinkingVerbs.length)];
  }

  // --- Markdown setup ---
  marked.use({ gfm: true, breaks: false });

  function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text));
  }

  function highlightCodeBlocks(el) {
    el.querySelectorAll("pre code:not(.hljs)").forEach(function(block) {
      hljs.highlightElement(block);
    });
  }

  function addCopyButtons(el) {
    el.querySelectorAll("pre").forEach(function(pre) {
      if (pre.querySelector(".copy-code-btn")) return;
      var btn = document.createElement("button");
      btn.className = "copy-code-btn";
      btn.innerHTML = iconHtml("clipboard");
      btn.title = "Copy code";
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var code = pre.querySelector("code");
        var text = code ? code.textContent : pre.textContent;
        if (!text) return;
        navigator.clipboard.writeText(text).then(function() {
          btn.innerHTML = iconHtml("check");
          btn.classList.add("copied");
          refreshIcons();
          setTimeout(function() {
            btn.innerHTML = iconHtml("clipboard");
            btn.classList.remove("copied");
            refreshIcons();
          }, 2000);
        });
      });
      pre.appendChild(btn);
      refreshIcons();
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // --- Sidebar ---
  function renderSessionList(sessions) {
    sessionListEl.innerHTML = "";
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var el = document.createElement("div");
      el.className = "session-item" + (s.active ? " active" : "");
      el.dataset.sessionId = s.id;

      var html = "";
      if (s.isProcessing) {
        html += '<span class="session-processing"></span>';
      }
      html += escapeHtml(s.title || "New Session");
      el.innerHTML = html;

      el.addEventListener("click", (function(id) {
        return function() {
          if (ws && connected) {
            ws.send(JSON.stringify({ type: "switch_session", id: id }));
            closeSidebar();
          }
        };
      })(s.id));

      sessionListEl.appendChild(el);
    }
  }

  function openSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("visible");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("visible");
  }

  hamburgerBtn.addEventListener("click", function() {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  sidebarOverlay.addEventListener("click", closeSidebar);

  newSessionBtn.addEventListener("click", function() {
    if (ws && connected) {
      ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
  });

  // --- Status & Activity ---
  function setStatus(status) {
    statusDot.className = "status-dot";
    if (status === "connected") {
      statusDot.classList.add("connected");
      statusTextEl.textContent = "Connected";
      connected = true;
      sendBtn.disabled = false;
    } else if (status === "processing") {
      statusDot.classList.add("processing");
      statusTextEl.textContent = "";
      processing = true;
      sendBtn.disabled = true;
    } else {
      statusTextEl.textContent = "Disconnected";
      connected = false;
      sendBtn.disabled = true;
    }
  }

  function setActivity(text) {
    if (text) {
      if (!activityEl) {
        activityEl = document.createElement("div");
        activityEl.className = "activity-inline";
        activityEl.innerHTML =
          '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
          '<span class="activity-text"></span>';
        messagesEl.appendChild(activityEl);
        refreshIcons();
      }
      activityEl.querySelector(".activity-text").textContent = text;
      scrollToBottom();
    } else {
      if (activityEl) {
        activityEl.remove();
        activityEl = null;
      }
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(function() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // --- Plan mode state ---
  var inPlanMode = false;
  var planContent = null; // stores plan markdown from Write tool

  // --- Todo state ---
  var todoItems = []; // [{id, content, status, activeForm}]
  var todoWidgetEl = null;

  // --- Tool helpers ---
  var PLAN_MODE_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1 };
  var TODO_TOOLS = { TodoWrite: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1 };
  var HIDDEN_RESULT_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1, TodoWrite: 1 };

  function isPlanFile(filePath) {
    return filePath && filePath.indexOf(".claude/plans/") !== -1;
  }

  function toolSummary(name, input) {
    if (!input || typeof input !== "object") return "";
    switch (name) {
      case "Read":       return shortPath(input.file_path);
      case "Edit":       return shortPath(input.file_path);
      case "Write":      return shortPath(input.file_path);
      case "Bash":       return (input.command || "").substring(0, 80);
      case "Glob":       return input.pattern || "";
      case "Grep":       return (input.pattern || "") + (input.path ? " in " + shortPath(input.path) : "");
      case "WebFetch":   return input.url || "";
      case "WebSearch":  return input.query || "";
      case "Task":       return input.description || "";
      case "EnterPlanMode": return "";
      case "ExitPlanMode":  return "";
      default:           return JSON.stringify(input).substring(0, 60);
    }
  }

  function toolActivityText(name, input) {
    if (name === "Bash" && input && input.description) return input.description;
    if (name === "Read" && input && input.file_path) return "Reading " + shortPath(input.file_path);
    if (name === "Edit" && input && input.file_path) return "Editing " + shortPath(input.file_path);
    if (name === "Write" && input && input.file_path) return "Writing " + shortPath(input.file_path);
    if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
    if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
    if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
    if (name === "WebFetch") return "Fetching URL...";
    if (name === "Task" && input && input.description) return input.description;
    if (name === "EnterPlanMode") return "Entering plan mode...";
    if (name === "ExitPlanMode") return "Finalizing the plan...";
    return "Running " + name + "...";
  }

  function shortPath(p) {
    if (!p) return "";
    var parts = p.split("/");
    return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
  }

  // --- AskUserQuestion ---
  function renderAskUserQuestion(toolId, input) {
    finalizeAssistantBlock();
    stopThinking();

    var questions = input.questions || [];
    if (questions.length === 0) return;

    var container = document.createElement("div");
    container.className = "ask-user-container";
    container.dataset.toolId = toolId;

    var answers = {};
    var multiSelections = {};

    questions.forEach(function(q, qIdx) {
      var qDiv = document.createElement("div");
      qDiv.className = "ask-user-question";

      var qText = document.createElement("div");
      qText.className = "ask-user-question-text";
      qText.textContent = q.question || "";
      qDiv.appendChild(qText);

      var optionsDiv = document.createElement("div");
      optionsDiv.className = "ask-user-options";

      var isMulti = q.multiSelect || false;
      if (isMulti) multiSelections[qIdx] = new Set();

      (q.options || []).forEach(function(opt) {
        var btn = document.createElement("button");
        btn.className = "ask-user-option";
        btn.innerHTML =
          '<div class="option-label"></div>' +
          (opt.description ? '<div class="option-desc"></div>' : '');
        btn.querySelector(".option-label").textContent = opt.label;
        if (opt.description) btn.querySelector(".option-desc").textContent = opt.description;

        btn.addEventListener("click", function() {
          if (container.classList.contains("answered")) return;

          if (isMulti) {
            var set = multiSelections[qIdx];
            if (set.has(opt.label)) {
              set.delete(opt.label);
              btn.classList.remove("selected");
            } else {
              set.add(opt.label);
              btn.classList.add("selected");
            }
          } else {
            optionsDiv.querySelectorAll(".ask-user-option").forEach(function(b) {
              b.classList.remove("selected");
            });
            btn.classList.add("selected");
            answers[qIdx] = opt.label;
            var otherInput = qDiv.querySelector(".ask-user-other input");
            if (otherInput) otherInput.value = "";
            if (questions.length === 1) {
              submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
            }
          }
        });

        optionsDiv.appendChild(btn);
      });

      qDiv.appendChild(optionsDiv);

      // "Other" text input
      var otherDiv = document.createElement("div");
      otherDiv.className = "ask-user-other";
      var otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.placeholder = "Other...";
      otherInput.addEventListener("input", function() {
        if (container.classList.contains("answered")) return;
        if (otherInput.value.trim()) {
          optionsDiv.querySelectorAll(".ask-user-option").forEach(function(b) {
            b.classList.remove("selected");
          });
          if (isMulti) multiSelections[qIdx] = new Set();
          answers[qIdx] = otherInput.value.trim();
        }
      });
      otherInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
        }
      });
      otherDiv.appendChild(otherInput);

      var submitBtn = document.createElement("button");
      submitBtn.className = "ask-user-submit";
      submitBtn.textContent = "Submit";
      submitBtn.addEventListener("click", function() {
        submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
      });
      otherDiv.appendChild(submitBtn);

      qDiv.appendChild(otherDiv);
      container.appendChild(qDiv);
    });

    messagesEl.appendChild(container);
    setActivity(null);
    scrollToBottom();
  }

  function submitAskUserAnswer(container, toolId, questions, answers, multiSelections) {
    if (container.classList.contains("answered")) return;

    var result = {};
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (q.multiSelect && multiSelections[i] && multiSelections[i].size > 0) {
        result[i] = Array.from(multiSelections[i]).join(", ");
      } else if (answers[i]) {
        result[i] = answers[i];
      }
    }

    if (Object.keys(result).length === 0) return;

    container.classList.add("answered");

    if (ws && connected) {
      ws.send(JSON.stringify({
        type: "ask_user_response",
        toolId: toolId,
        answers: result,
      }));
    }
  }

  // --- Plan mode rendering ---
  function renderPlanBanner(type) {
    finalizeAssistantBlock();
    stopThinking();

    var el = document.createElement("div");
    el.className = "plan-banner";

    if (type === "enter") {
      inPlanMode = true;
      planContent = null;
      el.innerHTML =
        '<span class="plan-banner-icon">' + iconHtml("map") + '</span>' +
        '<span class="plan-banner-text">Entered plan mode</span>' +
        '<span class="plan-banner-hint">Exploring codebase and designing implementation...</span>';
      el.classList.add("plan-enter");
    } else {
      inPlanMode = false;
      el.innerHTML =
        '<span class="plan-banner-icon">' + iconHtml("check-circle") + '</span>' +
        '<span class="plan-banner-text">Plan ready for review</span>';
      el.classList.add("plan-exit");
    }

    messagesEl.appendChild(el);
    refreshIcons();
    scrollToBottom();
    return el;
  }

  function renderPlanCard(content) {
    finalizeAssistantBlock();

    var el = document.createElement("div");
    el.className = "plan-card";

    var header = document.createElement("div");
    header.className = "plan-card-header";
    header.innerHTML =
      '<span class="plan-card-icon">' + iconHtml("file-text") + '</span>' +
      '<span class="plan-card-title">Implementation Plan</span>' +
      '<span class="plan-card-chevron">' + iconHtml("chevron-down") + '</span>';

    var body = document.createElement("div");
    body.className = "plan-card-body";
    body.innerHTML = renderMarkdown(content);
    highlightCodeBlocks(body);
    addCopyButtons(body);

    header.addEventListener("click", function() {
      el.classList.toggle("collapsed");
    });

    el.appendChild(header);
    el.appendChild(body);
    messagesEl.appendChild(el);
    refreshIcons();
    scrollToBottom();
    return el;
  }

  // --- Todo rendering ---
  function todoStatusIcon(status) {
    switch (status) {
      case "completed": return iconHtml("check-circle");
      case "in_progress": return iconHtml("loader", "icon-spin");
      default: return iconHtml("circle");
    }
  }

  function handleTodoWrite(input) {
    if (!input || !Array.isArray(input.todos)) return;
    todoItems = input.todos.map(function(t, i) {
      return {
        id: t.id || String(i + 1),
        content: t.content || t.subject || "",
        status: t.status || "pending",
        activeForm: t.activeForm || "",
      };
    });
    renderTodoWidget();
  }

  function handleTaskCreate(input) {
    if (!input) return;
    var id = String(todoItems.length + 1);
    todoItems.push({
      id: id,
      content: input.subject || input.description || "",
      status: "pending",
      activeForm: input.activeForm || "",
    });
    renderTodoWidget();
  }

  function handleTaskUpdate(input) {
    if (!input || !input.taskId) return;
    for (var i = 0; i < todoItems.length; i++) {
      if (todoItems[i].id === input.taskId) {
        if (input.status === "deleted") {
          todoItems.splice(i, 1);
        } else {
          if (input.status) todoItems[i].status = input.status;
          if (input.subject) todoItems[i].content = input.subject;
          if (input.activeForm) todoItems[i].activeForm = input.activeForm;
        }
        break;
      }
    }
    renderTodoWidget();
  }

  function renderTodoWidget() {
    if (todoItems.length === 0) {
      if (todoWidgetEl) { todoWidgetEl.remove(); todoWidgetEl = null; }
      return;
    }

    var isNew = !todoWidgetEl;
    if (isNew) {
      todoWidgetEl = document.createElement("div");
      todoWidgetEl.className = "todo-widget";
    }

    var completed = 0;
    for (var i = 0; i < todoItems.length; i++) {
      if (todoItems[i].status === "completed") completed++;
    }

    var html = '<div class="todo-header">' +
      '<span class="todo-header-icon">' + iconHtml("list-checks") + '</span>' +
      '<span class="todo-header-title">Tasks</span>' +
      '<span class="todo-header-count">' + completed + '/' + todoItems.length + '</span>' +
    '</div>';
    html += '<div class="todo-progress"><div class="todo-progress-bar" style="width:' +
      (todoItems.length > 0 ? Math.round(completed / todoItems.length * 100) : 0) + '%"></div></div>';
    html += '<div class="todo-items">';
    for (var i = 0; i < todoItems.length; i++) {
      var t = todoItems[i];
      var statusClass = t.status === "completed" ? "completed" : t.status === "in_progress" ? "in-progress" : "pending";
      html += '<div class="todo-item ' + statusClass + '">' +
        '<span class="todo-item-icon">' + todoStatusIcon(t.status) + '</span>' +
        '<span class="todo-item-text">' + escapeHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content) + '</span>' +
      '</div>';
    }
    html += '</div>';

    todoWidgetEl.innerHTML = html;

    if (isNew) {
      messagesEl.appendChild(todoWidgetEl);
    }
    refreshIcons();
    scrollToBottom();
  }

  // --- DOM: Messages ---
  function addUserMessage(text, images) {
    var div = document.createElement("div");
    div.className = "msg-user";
    var bubble = document.createElement("div");
    bubble.className = "bubble";

    if (images && images.length > 0) {
      var imgRow = document.createElement("div");
      imgRow.className = "bubble-images";
      for (var i = 0; i < images.length; i++) {
        var img = document.createElement("img");
        img.src = "data:" + images[i].mediaType + ";base64," + images[i].data;
        img.className = "bubble-img";
        imgRow.appendChild(img);
      }
      bubble.appendChild(imgRow);
    }

    if (text) {
      var textEl = document.createElement("span");
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }

    div.appendChild(bubble);
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function ensureAssistantBlock() {
    if (!currentMsgEl) {
      currentMsgEl = document.createElement("div");
      currentMsgEl.className = "msg-assistant";
      currentMsgEl.innerHTML = '<div class="md-content"></div>';
      messagesEl.appendChild(currentMsgEl);
      currentFullText = "";
    }
    return currentMsgEl;
  }

  function appendDelta(text) {
    ensureAssistantBlock();
    currentFullText += text;
    var contentEl = currentMsgEl.querySelector(".md-content");
    contentEl.innerHTML = renderMarkdown(currentFullText);

    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function() {
      highlightCodeBlocks(contentEl);
      addCopyButtons(contentEl);
    }, 150);

    scrollToBottom();
  }

  function finalizeAssistantBlock() {
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        highlightCodeBlocks(contentEl);
        addCopyButtons(contentEl);
      }
    }
    currentMsgEl = null;
    currentFullText = "";
  }

  function addSystemMessage(text, isError) {
    var div = document.createElement("div");
    div.className = "sys-msg" + (isError ? " error" : "");
    div.innerHTML = '<span class="sys-text"></span>';
    div.querySelector(".sys-text").textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function resetClientState() {
    messagesEl.innerHTML = "";
    currentMsgEl = null;
    currentFullText = "";
    tools = {};
    currentThinking = null;
    activityEl = null;
    processing = false;
    inPlanMode = false;
    planContent = null;
    todoItems = [];
    todoWidgetEl = null;
    setActivity(null);
    setStatus("connected");
  }

  // --- Thinking ---
  function startThinking() {
    finalizeAssistantBlock();

    var el = document.createElement("div");
    el.className = "thinking-item";
    el.innerHTML =
      '<div class="thinking-header">' +
        '<span class="thinking-chevron">' + iconHtml("chevron-right") + '</span>' +
        '<span class="thinking-label">Thinking</span>' +
        '<span class="thinking-duration"></span>' +
        '<span class="thinking-spinner">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="thinking-content"></div>';

    el.querySelector(".thinking-header").addEventListener("click", function() {
      el.classList.toggle("expanded");
    });

    messagesEl.appendChild(el);
    refreshIcons();
    scrollToBottom();
    currentThinking = { el: el, fullText: "", startTime: Date.now() };
    setActivity(randomThinkingVerb() + "...");
  }

  function appendThinking(text) {
    if (!currentThinking) return;
    currentThinking.fullText += text;
    currentThinking.el.querySelector(".thinking-content").textContent = currentThinking.fullText;
    scrollToBottom();
  }

  function stopThinking() {
    if (!currentThinking) return;
    var secs = ((Date.now() - currentThinking.startTime) / 1000).toFixed(1);
    currentThinking.el.classList.add("done");
    currentThinking.el.querySelector(".thinking-duration").textContent = " " + secs + "s";
    currentThinking = null;
  }

  // --- Tool items ---
  function createToolItem(id, name) {
    finalizeAssistantBlock();
    stopThinking();

    var el = document.createElement("div");
    el.className = "tool-item";
    el.dataset.toolId = id;
    el.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-bullet"></span>' +
        '<span class="tool-name"></span>' +
        '<span class="tool-desc"></span>' +
        '<span class="tool-status-icon">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="tool-subtitle">' +
        '<span class="tool-connector">&#9492;</span>' +
        '<span class="tool-subtitle-text">Running...</span>' +
      '</div>';

    el.querySelector(".tool-name").textContent = name;

    messagesEl.appendChild(el);
    refreshIcons();
    scrollToBottom();

    tools[id] = { el: el, name: name, input: null, done: false };
    setActivity("Running " + name + "...");
  }

  function updateToolExecuting(id, name, input) {
    var tool = tools[id];
    if (!tool) return;

    tool.input = input;
    tool.el.querySelector(".tool-desc").textContent = toolSummary(name, input);
    setActivity(toolActivityText(name, input));

    var subtitleText = tool.el.querySelector(".tool-subtitle-text");
    if (subtitleText) subtitleText.textContent = toolActivityText(name, input);

    scrollToBottom();
  }

  function updateToolResult(id, content, isError) {
    var tool = tools[id];
    if (!tool) return;

    var subtitleText = tool.el.querySelector(".tool-subtitle-text");
    if (subtitleText && tool.input) {
      subtitleText.textContent = toolActivityText(tool.name, tool.input);
    }

    var resultBlock = document.createElement("div");
    resultBlock.className = "tool-result-block";
    var pre = document.createElement("pre");
    if (isError) pre.className = "is-error";
    var displayContent = content || "(no output)";
    if (displayContent.length > 10000) displayContent = displayContent.substring(0, 10000) + "\n... (truncated)";
    pre.textContent = displayContent;
    resultBlock.appendChild(pre);
    tool.el.appendChild(resultBlock);

    addCopyButtons(resultBlock);

    tool.el.querySelector(".tool-header").addEventListener("click", function() {
      resultBlock.classList.toggle("collapsed");
    });

    markToolDone(id, isError);
    scrollToBottom();
  }

  function markToolDone(id, isError) {
    var tool = tools[id];
    if (!tool || tool.done) return;

    tool.done = true;
    if (!tool.el) return; // hidden tool (plan mode)

    tool.el.classList.add("done");
    if (isError) tool.el.classList.add("error");

    var icon = tool.el.querySelector(".tool-status-icon");
    if (isError) {
      icon.innerHTML = '<span class="err-icon">' + iconHtml("alert-triangle") + '</span>';
    } else {
      icon.innerHTML = '<span class="check">' + iconHtml("check") + '</span>';
    }
    refreshIcons();
  }

  function markAllToolsDone() {
    for (var id in tools) {
      if (tools.hasOwnProperty(id) && !tools[id].done) {
        markToolDone(id, false);
      }
    }
  }

  function addTurnMeta(cost, duration) {
    var div = document.createElement("div");
    div.className = "turn-meta";
    var parts = [];
    if (cost != null) parts.push("$" + cost.toFixed(4));
    if (duration != null) parts.push((duration / 1000).toFixed(1) + "s");
    if (parts.length) {
      div.textContent = parts.join(" \u00b7 ");
      messagesEl.appendChild(div);
      scrollToBottom();
    }
  }

  // --- WebSocket ---
  function connect() {
    if (ws) { ws.onclose = null; ws.close(); }

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);

    ws.onopen = function() {
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    ws.onclose = function() {
      setStatus("disconnected");
      processing = false;
      setActivity(null);
      scheduleReconnect();
    };

    ws.onerror = function() {};

    ws.onmessage = function(event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch(e) { return; }

      switch (msg.type) {
        case "info":
          projectNameEl.textContent = msg.project || msg.cwd;
          break;

        case "slash_commands":
          slashCommands = (msg.commands || []).map(function(name) {
            return { name: name, desc: "Skill" };
          });
          break;

        case "session_list":
          renderSessionList(msg.sessions || []);
          break;

        case "session_switched":
          activeSessionId = msg.id;
          resetClientState();
          break;

        case "user_message":
          addUserMessage(msg.text, msg.images || null);
          break;

        case "status":
          if (msg.status === "processing") {
            setStatus("processing");
            setActivity(randomThinkingVerb() + "...");
          }
          break;

        case "thinking_start":
          startThinking();
          break;

        case "thinking_delta":
          if (typeof msg.text === "string") appendThinking(msg.text);
          break;

        case "thinking_stop":
          stopThinking();
          setActivity(randomThinkingVerb() + "...");
          break;

        case "delta":
          if (typeof msg.text !== "string") break;
          stopThinking();
          setActivity(null);
          appendDelta(msg.text);
          break;

        case "tool_start":
          stopThinking();
          markAllToolsDone();
          if (msg.name === "EnterPlanMode") {
            renderPlanBanner("enter");
            tools[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (msg.name === "ExitPlanMode") {
            if (planContent) {
              renderPlanCard(planContent);
            }
            renderPlanBanner("exit");
            tools[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (TODO_TOOLS[msg.name]) {
            tools[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else {
            createToolItem(msg.id, msg.name);
          }
          break;

        case "tool_executing":
          if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
            var askTool = tools[msg.id];
            if (askTool) {
              if (askTool.el) askTool.el.style.display = "none";
              askTool.done = true;
            }
            renderAskUserQuestion(msg.id, msg.input);
          } else if (msg.name === "Write" && msg.input && isPlanFile(msg.input.file_path)) {
            planContent = msg.input.content || "";
            updateToolExecuting(msg.id, msg.name, msg.input);
          } else if (msg.name === "TodoWrite") {
            handleTodoWrite(msg.input);
          } else if (msg.name === "TaskCreate") {
            handleTaskCreate(msg.input);
          } else if (msg.name === "TaskUpdate") {
            handleTaskUpdate(msg.input);
          } else if (TODO_TOOLS[msg.name]) {
            // TaskList, TaskGet - silently skip
          } else {
            var t = tools[msg.id];
            if (t && t.hidden) break;
            updateToolExecuting(msg.id, msg.name, msg.input);
          }
          break;

        case "tool_result":
          if (msg.content != null) {
            var tr = tools[msg.id];
            if (tr && tr.hidden) break; // skip hidden plan tools
            updateToolResult(msg.id, msg.content, msg.is_error || false);
          }
          break;

        case "result":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          finalizeAssistantBlock();
          addTurnMeta(msg.cost, msg.duration);
          break;

        case "done":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          finalizeAssistantBlock();
          processing = false;
          setStatus("connected");
          tools = {};
          break;

        case "stderr":
          addSystemMessage(msg.text, false);
          break;

        case "error":
          setActivity(null);
          addSystemMessage(msg.text, true);
          break;
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function() {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
  }

  // --- Sending messages ---
  function sendMessage() {
    var text = inputEl.value.trim();
    var images = pendingImages.slice();
    if (!text && images.length === 0) return;
    hideSlashMenu();

    if (text === "/clear") {
      messagesEl.innerHTML = "";
      inputEl.value = "";
      clearPendingImages();
      autoResize();
      return;
    }

    if (!connected || processing) return;

    addUserMessage(text, images.length > 0 ? images : null);

    var payload = { type: "message", text: text || "" };
    if (images.length > 0) {
      payload.images = images;
    }
    ws.send(JSON.stringify(payload));

    inputEl.value = "";
    clearPendingImages();
    autoResize();
    inputEl.focus();
  }

  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  }

  // --- Image paste ---
  function addPendingImage(dataUrl) {
    // dataUrl = "data:image/png;base64,xxxx..."
    var commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return;
    var header = dataUrl.substring(0, commaIdx); // "data:image/png;base64"
    var data = dataUrl.substring(commaIdx + 1);
    var typeMatch = header.match(/data:(image\/[^;,]+)/);
    if (!typeMatch || !data) return;
    pendingImages.push({ mediaType: typeMatch[1], data: data });
    renderImagePreviews();
  }

  function removePendingImage(idx) {
    pendingImages.splice(idx, 1);
    renderImagePreviews();
  }

  function clearPendingImages() {
    pendingImages = [];
    renderImagePreviews();
  }

  function renderImagePreviews() {
    imagePreviewBar.innerHTML = "";
    if (pendingImages.length === 0) {
      imagePreviewBar.classList.remove("visible");
      return;
    }
    imagePreviewBar.classList.add("visible");
    for (var i = 0; i < pendingImages.length; i++) {
      (function(idx) {
        var wrap = document.createElement("div");
        wrap.className = "image-preview-thumb";
        var img = document.createElement("img");
        img.src = "data:" + pendingImages[idx].mediaType + ";base64," + pendingImages[idx].data;
        var removeBtn = document.createElement("button");
        removeBtn.className = "image-preview-remove";
        removeBtn.innerHTML = iconHtml("x");
        removeBtn.addEventListener("click", function() {
          removePendingImage(idx);
        });
        wrap.appendChild(img);
        wrap.appendChild(removeBtn);
        imagePreviewBar.appendChild(wrap);
      })(i);
    }
    refreshIcons();
  }

  function readImageBlob(blob) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      addPendingImage(ev.target.result);
    };
    reader.readAsDataURL(blob);
  }

  document.addEventListener("paste", function(e) {
    var cd = e.clipboardData;
    if (!cd) return;

    var found = false;

    // Try clipboardData.files first (better Safari/iOS support)
    if (cd.files && cd.files.length > 0) {
      for (var i = 0; i < cd.files.length; i++) {
        if (cd.files[i].type.indexOf("image/") === 0) {
          found = true;
          readImageBlob(cd.files[i]);
        }
      }
    }

    // Fall back to clipboardData.items
    if (!found && cd.items) {
      for (var i = 0; i < cd.items.length; i++) {
        if (cd.items[i].type.indexOf("image/") === 0) {
          var blob = cd.items[i].getAsFile();
          if (blob) {
            found = true;
            readImageBlob(blob);
          }
        }
      }
    }

    if (found) e.preventDefault();
  });

  // --- Slash menu ---
  function getAllCommands() {
    return builtinCommands.concat(slashCommands);
  }

  function showSlashMenu(filter) {
    var query = filter.toLowerCase();
    slashFiltered = getAllCommands().filter(function(c) {
      return c.name.toLowerCase().indexOf(query) !== -1;
    });
    if (slashFiltered.length === 0) { hideSlashMenu(); return; }

    slashActiveIdx = 0;
    slashMenu.innerHTML = slashFiltered.map(function(c, i) {
      return '<div class="slash-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
        '<span class="slash-cmd">/' + c.name + '</span>' +
        '<span class="slash-desc">' + c.desc + '</span>' +
      '</div>';
    }).join("");
    slashMenu.classList.add("visible");

    slashMenu.querySelectorAll(".slash-item").forEach(function(el) {
      el.addEventListener("click", function() {
        selectSlashItem(parseInt(el.dataset.idx));
      });
    });
  }

  function hideSlashMenu() {
    slashMenu.classList.remove("visible");
    slashMenu.innerHTML = "";
    slashActiveIdx = -1;
    slashFiltered = [];
  }

  function selectSlashItem(idx) {
    if (idx < 0 || idx >= slashFiltered.length) return;
    var cmd = slashFiltered[idx];
    inputEl.value = "/" + cmd.name + " ";
    hideSlashMenu();
    autoResize();
    inputEl.focus();
  }

  function updateSlashHighlight() {
    slashMenu.querySelectorAll(".slash-item").forEach(function(el, i) {
      el.classList.toggle("active", i === slashActiveIdx);
    });
    var activeEl = slashMenu.querySelector(".slash-item.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  // --- Input handlers ---
  inputEl.addEventListener("input", function() {
    autoResize();
    var val = inputEl.value;
    if (val.startsWith("/") && !val.includes(" ") && val.length > 1) {
      showSlashMenu(val.substring(1));
    } else if (val === "/") {
      showSlashMenu("");
    } else {
      hideSlashMenu();
    }
  });

  inputEl.addEventListener("compositionstart", function() { isComposing = true; });
  inputEl.addEventListener("compositionend", function() { isComposing = false; });

  inputEl.addEventListener("keydown", function(e) {
    if (slashFiltered.length > 0 && slashMenu.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx + 1) % slashFiltered.length;
        updateSlashHighlight();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx - 1 + slashFiltered.length) % slashFiltered.length;
        updateSlashHighlight();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSlashItem(slashActiveIdx);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideSlashMenu();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", function() { sendMessage(); });

  // --- Mobile viewport ---
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function() {
      $("app").style.height = window.visualViewport.height + "px";
      scrollToBottom();
    });
    window.visualViewport.addEventListener("scroll", function() {
      $("app").style.height = window.visualViewport.height + "px";
    });
  }

  // --- Init ---
  lucide.createIcons();
  connect();
  inputEl.focus();
})();
