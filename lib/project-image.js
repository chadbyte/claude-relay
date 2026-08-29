var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;

/**
 * Attach image handling to a project context.
 *
 * ctx fields:
 *   cwd, slug
 */
function attachImage(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var fsAsUser = ctx.fsAsUser;

  // --- Chat image storage ---
  var _imgConfig = require("./config");
  var _imgUtils = require("./utils");
  var _imagesBaseDir = path.join(_imgConfig.CONFIG_DIR, "images");
  var _imagesEncodedCwd = _imgUtils.encodeCwd(cwd);
  var imagesDir = ctx.imagesDir || path.join(_imagesBaseDir, _imagesEncodedCwd);

  function isWithin(base, candidate) {
    return candidate === base || candidate.indexOf(base + path.sep) === 0;
  }

  function saveGeneratedImageToProject(fileName, requestedPath, overwrite, osUserInfo) {
    if (typeof fileName !== "string" || !/^\d+-[a-f0-9]+\.\w+$/.test(fileName)) {
      return { ok: false, status: 400, error: "Invalid generated image" };
    }
    if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.length > 500) {
      return { ok: false, status: 400, error: "Enter a project path" };
    }

    var sourcePath = path.join(imagesDir, fileName);
    var sourceExt = path.extname(fileName).toLowerCase();
    var targetPath = requestedPath.trim();
    if (path.isAbsolute(targetPath)) {
      return { ok: false, status: 400, error: "Use a project-relative path" };
    }
    var targetExt = path.extname(targetPath).toLowerCase();
    if (targetExt !== sourceExt) {
      return { ok: false, status: 400, error: "Keep the " + sourceExt + " file extension" };
    }

    var projectRoot;
    var targetAbs;
    try {
      projectRoot = fs.realpathSync(cwd);
      targetAbs = path.resolve(projectRoot, targetPath);
    } catch (e) {
      return { ok: false, status: 400, error: "Project path is not available" };
    }
    if (targetAbs === projectRoot || !isWithin(projectRoot, targetAbs)) {
      return { ok: false, status: 403, error: "Path must stay inside the project" };
    }

    try {
      var sourceReal = fs.realpathSync(sourcePath);
      var imagesRoot = fs.realpathSync(imagesDir);
      if (!isWithin(imagesRoot, sourceReal) || !fs.statSync(sourceReal).isFile()) {
        return { ok: false, status: 404, error: "Generated image not found" };
      }

      var parentDir = path.dirname(targetAbs);
      var existingParent = parentDir;
      while (!fs.existsSync(existingParent) && existingParent !== projectRoot) {
        existingParent = path.dirname(existingParent);
      }
      var realExistingParent = fs.realpathSync(existingParent);
      if (!isWithin(projectRoot, realExistingParent)) {
        return { ok: false, status: 403, error: "Path must stay inside the project" };
      }
      if (osUserInfo && typeof fsAsUser === "function") {
        fsAsUser("mkdir", { dir: parentDir }, osUserInfo);
      } else {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      var realParent = fs.realpathSync(parentDir);
      if (!isWithin(projectRoot, realParent)) {
        return { ok: false, status: 403, error: "Path must stay inside the project" };
      }
      if (fs.existsSync(targetAbs)) {
        if (fs.lstatSync(targetAbs).isSymbolicLink()) {
          return { ok: false, status: 403, error: "Symbolic link targets cannot be replaced" };
        }
        if (!overwrite) {
          return { ok: false, status: 409, error: "A file already exists at this path" };
        }
      }

      if (osUserInfo && typeof fsAsUser === "function") {
        fsAsUser("copy", { source: sourceReal, file: targetAbs, overwrite: !!overwrite }, osUserInfo);
      } else {
        fs.copyFileSync(sourceReal, targetAbs, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
      }
      try { fs.chmodSync(targetAbs, 0o644); } catch (e2) {}
      return { ok: true, path: path.relative(projectRoot, targetAbs).split(path.sep).join("/") };
    } catch (e) {
      if (e && e.code === "EEXIST") {
        return { ok: false, status: 409, error: "A file already exists at this path" };
      }
      return { ok: false, status: 500, error: "Could not save the generated image" };
    }
  }

  // Convert imageRefs in history entries to images with URLs for the client
  function hydrateImageRefs(entry) {
    if (!entry) return entry;
    // Hydrate context_preview: convert screenshotFile to screenshotUrl
    if (entry.type === "context_preview" && entry.tab && entry.tab.screenshotFile) {
      var hydrated = {};
      for (var k in entry) hydrated[k] = entry[k];
      hydrated.tab = {};
      for (var tk in entry.tab) hydrated.tab[tk] = entry.tab[tk];
      hydrated.tab.screenshotUrl = "/p/" + slug + "/images/" + entry.tab.screenshotFile;
      delete hydrated.tab.screenshotFile;
      return hydrated;
    }
    if (!entry.imageRefs) return entry;
    if (entry.type !== "user_message" && entry.type !== "mention_user" && entry.type !== "user_mention" && entry.type !== "generated_image") return entry;
    var images = [];
    for (var ri = 0; ri < entry.imageRefs.length; ri++) {
      var ref = entry.imageRefs[ri];
      images.push({ mediaType: ref.mediaType, url: "/p/" + slug + "/images/" + ref.file });
    }
    var hydrated = {};
    for (var k2 in entry) {
      if (k2 !== "imageRefs") hydrated[k2] = entry[k2];
    }
    hydrated.images = images;
    return hydrated;
  }

  function saveImageFile(mediaType, base64data, ownerLinuxUser) {
    try { fs.mkdirSync(imagesDir, { recursive: true }); } catch (e) {}
    var ext = mediaType === "image/png" ? ".png" : mediaType === "image/gif" ? ".gif" : mediaType === "image/webp" ? ".webp" : ".jpg";
    var hash = crypto.createHash("sha256").update(base64data).digest("hex").substring(0, 16);
    var fileName = Date.now() + "-" + hash + ext;
    var filePath = path.join(imagesDir, fileName);
    try {
      fs.writeFileSync(filePath, Buffer.from(base64data, "base64"));
      if (process.platform !== "win32") {
        // 644 so all local users can read (needed for git, copy, etc.)
        try { fs.chmodSync(filePath, 0o644); } catch (e) {}
        // In OS-user mode the daemon runs as root, so chown the file
        // (and parent dirs) to the session owner to avoid permission issues.
        if (ownerLinuxUser) {
          try {
            var osUsersMod = require("./os-users");
            var uid = osUsersMod.getLinuxUserUid(ownerLinuxUser);
            if (uid != null) {
              execFileSync("chown", [String(uid), filePath]);
              // Also fix parent dirs if root-owned
              try {
                var dirStat = fs.statSync(imagesDir);
                if (dirStat.uid !== uid) {
                  execFileSync("chown", [String(uid), imagesDir]);
                }
              } catch (e2) {}
            }
          } catch (e) {}
        }
      }
      return fileName;
    } catch (e) {
      console.error("[images] Failed to save image:", e.message);
      return null;
    }
  }

  return {
    imagesDir: imagesDir,
    hydrateImageRefs: hydrateImageRefs,
    saveImageFile: saveImageFile,
    saveGeneratedImageToProject: saveGeneratedImageToProject,
  };
}

module.exports = { attachImage: attachImage };
