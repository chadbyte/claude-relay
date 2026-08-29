var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var EventEmitter = require("events");

var codex = require("../lib/yoke/adapters/codex");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var attachImage = require("../lib/project-image").attachImage;
var attachHTTP = require("../lib/project-http").attachHTTP;
var createSessionManager = require("../lib/sessions").createSessionManager;

test("Codex image generation normalizes to an ImageGen tool and generated image", function() {
  var state = codex.contractTestKit.createEventState("test-model");
  var started = codex.contractTestKit.normalizeEvent({
    method: "item/started",
    params: { item: { id: "image-1", type: "imageGeneration", status: "inProgress" } },
  }, state);
  var completed = codex.contractTestKit.normalizeEvent({
    method: "item/completed",
    params: {
      item: {
        id: "image-1",
        type: "imageGeneration",
        status: "completed",
        result: "cG5n",
        revisedPrompt: "A clay workspace",
        savedPath: "/tmp/image.png",
        transparentBackground: true,
      },
    },
  }, state);

  assert.strictEqual(started[0].yokeType, "tool_start");
  assert.strictEqual(started[0].toolName, "ImageGen");
  assert.strictEqual(started[1].yokeType, "tool_executing");
  assert.strictEqual(completed.length, 1);
  assert.deepStrictEqual(completed[0], {
    yokeType: "generated_image",
    toolId: "image-1",
    blockId: started[0].blockId,
    data: "cG5n",
    mediaType: "image/png",
    prompt: "A clay workspace",
    savedPath: "/tmp/image.png",
    transparentBackground: true,
    isError: false,
    status: "completed",
  });
});

test("generated image data is persisted by reference and delivered by URL", function() {
  var calls = [];
  var saved = [];
  var bridge = createSDKBridge({
    cwd: process.cwd(),
    slug: "demo",
    adapter: { vendor: "codex" },
    send: function () {},
    sessionManager: {
      sendAndRecord: function(session, stored, live) { calls.push({ stored: stored, live: live }); },
    },
    saveImageFile: function(mediaType, data) {
      saved.push({ mediaType: mediaType, data: data });
      return "generated.png";
    },
  });
  var session = { localId: 1 };

  bridge.processSDKMessage(session, {
    yokeType: "generated_image",
    toolId: "image-1",
    data: "data:image/png;base64,cG5n\n",
    prompt: "A clay workspace",
  });

  assert.deepStrictEqual(saved, [{ mediaType: "image/png", data: "cG5n" }]);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0].stored, {
    type: "tool_result",
    id: "image-1",
    content: "Image generated",
    is_error: false,
  });
  assert.deepStrictEqual(calls[1].stored.imageRefs, [{ mediaType: "image/png", file: "generated.png" }]);
  assert.strictEqual(calls[1].stored.prompt, "A clay workspace");
  assert.strictEqual(calls[1].stored.images, undefined);
  assert.strictEqual(calls[1].live.images[0].url, "/p/demo/images/generated.png");
  assert.strictEqual(calls[1].live.prompt, "A clay workspace");
  assert.strictEqual(JSON.stringify(calls).indexOf("cG5n"), -1);
});

test("generated images can be copied into a safe project path", function() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-generated-image-save-"));
  var projectDir = path.join(root, "project");
  var imagesDir = path.join(root, "images");
  var fileName = "1700000000000-abcdef1234567890.png";
  try {
    fs.mkdirSync(projectDir);
    fs.mkdirSync(imagesDir);
    fs.writeFileSync(path.join(imagesDir, fileName), Buffer.from("image-data"));
    var image = attachImage({ cwd: projectDir, slug: "demo", imagesDir: imagesDir });

    var saved = image.saveGeneratedImageToProject(fileName, "assets/generated/hero.png", false, null);
    assert.deepStrictEqual(saved, { ok: true, path: "assets/generated/hero.png" });
    assert.deepStrictEqual(fs.readFileSync(path.join(projectDir, "assets/generated/hero.png")), Buffer.from("image-data"));

    var conflict = image.saveGeneratedImageToProject(fileName, "assets/generated/hero.png", false, null);
    assert.strictEqual(conflict.status, 409);
    var replaced = image.saveGeneratedImageToProject(fileName, "assets/generated/hero.png", true, null);
    assert.strictEqual(replaced.ok, true);

    var traversal = image.saveGeneratedImageToProject(fileName, "../outside.png", false, null);
    assert.strictEqual(traversal.status, 403);
    var absolute = image.saveGeneratedImageToProject(fileName, path.join(projectDir, "absolute.png"), false, null);
    assert.strictEqual(absolute.status, 400);
    var wrongExtension = image.saveGeneratedImageToProject(fileName, "assets/generated/hero.jpg", false, null);
    assert.strictEqual(wrongExtension.status, 400);
    if (process.platform !== "win32") {
      var outsideDir = path.join(root, "outside");
      fs.mkdirSync(outsideDir);
      fs.symlinkSync(outsideDir, path.join(projectDir, "linked"));
      var linked = image.saveGeneratedImageToProject(fileName, "linked/nested/hero.png", false, null);
      assert.strictEqual(linked.status, 403);
      assert.strictEqual(fs.existsSync(path.join(outsideDir, "nested")), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("generated image save route forwards a project-relative destination", async function() {
  var request = new EventEmitter();
  request.method = "POST";
  request._clayUser = { role: "admin" };
  var received = null;
  var responseStatus = null;
  var finishResponse;
  var responseDone = new Promise(function(resolve) { finishResponse = resolve; });
  var response = {
    writeHead: function(status) { responseStatus = status; },
    end: function(body) { finishResponse(body); },
  };
  var handler = attachHTTP({
    cwd: process.cwd(),
    slug: "demo",
    project: "Demo",
    sm: { sessions: new Map() },
    imagesDir: "/tmp",
    osUsers: null,
    safePath: function() { return null; },
    safeAbsPath: function() { return null; },
    getOsUserInfoForReq: function() { return null; },
    saveGeneratedImageToProject: function(fileName, targetPath, overwrite) {
      received = { fileName: fileName, targetPath: targetPath, overwrite: overwrite };
      return { ok: true, path: targetPath };
    },
    _browserTabList: {},
  }).handleHTTP;

  var handled = handler(request, response, "/api/generated-image/save");
  request.emit("data", JSON.stringify({
    fileName: "1700000000000-abcdef1234567890.png",
    path: "assets/generated/hero.png",
    overwrite: false,
  }));
  request.emit("end");
  var responseBody = JSON.parse(await responseDone);

  assert.strictEqual(handled, true);
  assert.strictEqual(responseStatus, 200);
  assert.deepStrictEqual(received, {
    fileName: "1700000000000-abcdef1234567890.png",
    targetPath: "assets/generated/hero.png",
    overwrite: false,
  });
  assert.deepStrictEqual(responseBody, { ok: true, path: "assets/generated/hero.png" });
});

test("generated image history references hydrate for replay", function() {
  var image = attachImage({ cwd: "/tmp/clay-image-generation-test", slug: "demo" });
  var hydrated = image.hydrateImageRefs({
    type: "generated_image",
    id: "image-1",
    imageRefs: [{ mediaType: "image/png", file: "generated.png" }],
  });

  assert.strictEqual(hydrated.imageRefs, undefined);
  assert.deepStrictEqual(hydrated.images, [{
    mediaType: "image/png",
    url: "/p/demo/images/generated.png",
  }]);
});

test("session history stores image references while clients receive hydrated URLs", function() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-generated-image-session-"));
  try {
    var sent = [];
    var manager = createSessionManager({
      cwd: path.join(root, "project"),
      sessionsBase: path.join(root, "sessions"),
      cliSessionsDir: path.join(root, "cli-sessions"),
      send: function(message) { sent.push(message); },
    });
    var session = manager.createSession({ vendor: "codex" });
    sent.length = 0;
    var stored = {
      type: "generated_image",
      imageRefs: [{ mediaType: "image/png", file: "generated.png" }],
    };
    var live = {
      type: "generated_image",
      images: [{ mediaType: "image/png", url: "/p/demo/images/generated.png" }],
    };

    manager.sendAndRecord(session, stored, live);

    assert.strictEqual(session.history[0], stored);
    assert.strictEqual(session.history[0].images, undefined);
    assert.strictEqual(sent[0], live);
    assert.strictEqual(sent[0]._ts, stored._ts);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("generated image UI includes open, download, project save, and prompt details", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/generated-images.js"), "utf8");
  var router = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var stylesheet = fs.readFileSync(path.join(__dirname, "../lib/public/style.css"), "utf8");
  var server = fs.readFileSync(path.join(__dirname, "../lib/project-http.js"), "utf8");
  assert.match(source, /showImageModal\(image\.url\)/);
  assert.match(source, /downloadLink\.download/);
  assert.match(source, /showGeneratedImageDetails/);
  assert.match(source, /Copy prompt/);
  assert.match(source, /Save to project/);
  assert.match(source, /api\/generated-image\/save/);
  assert.match(source, /Replace file/);
  assert.match(source, /renderGeneratedImage/);
  assert.match(source, /generated-image-row/);
  assert.match(source, /renderImageGenerationProgress/);
  assert.match(source, /progressRow\.replaceWith\(row\)/);
  assert.match(router, /case "generated_image":/);
  assert.match(router, /renderImageGenerationProgress\(msg\)/);
  assert.match(stylesheet, /css\/generated-images\.css/);
  assert.match(server, /urlPath === "\/api\/generated-image\/save"/);
});
