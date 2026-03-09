/**
 * Shared utility functions.
 */

var fs = require("fs");

/**
 * Encode a cwd path into a filesystem-safe directory/file name.
 * Replaces all non-alphanumeric characters with hyphens, matching
 * Claude Code CLI's encoding logic exactly (/[^a-zA-Z0-9]/g -> "-").
 *
 * Example: "/Users/jon.doe_42/my project" -> "-Users-jon-doe-42-my-project"
 */
function encodeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Legacy encoding (pre-#182 fix). Only slashes and dots were replaced.
 * Used for fallback resolution of on-disk data written before the fix.
 */
function legacyEncodeCwd(cwd) {
  return cwd.replace(/[\/\.]/g, "-");
}

/**
 * Try candidate encoded names against a base directory.
 * Returns the first match that exists on disk, or the first candidate
 * (newest encoding) if none exist yet.
 */
function resolveEncoded(baseDir, cwd, ext, checkFn) {
  var newEncoded = encodeCwd(cwd);
  var legacyEncoded = legacyEncodeCwd(cwd);
  if (newEncoded === legacyEncoded) return newEncoded;
  var full = baseDir + "/" + newEncoded + (ext || "");
  try { if (checkFn(full)) return newEncoded; } catch (e) {}
  var legacyFull = baseDir + "/" + legacyEncoded + (ext || "");
  try { if (checkFn(legacyFull)) return legacyEncoded; } catch (e) {}
  return newEncoded;
}

/**
 * Resolve an encoded directory path with legacy fallback.
 */
function resolveEncodedDir(baseDir, cwd) {
  return resolveEncoded(baseDir, cwd, "", function(p) {
    return fs.statSync(p).isDirectory();
  });
}

/**
 * Resolve an encoded file path with legacy fallback.
 */
function resolveEncodedFile(baseDir, cwd, ext) {
  return resolveEncoded(baseDir, cwd, ext, function(p) {
    return fs.statSync(p).isFile();
  });
}

module.exports = {
  encodeCwd: encodeCwd,
  resolveEncodedDir: resolveEncodedDir,
  resolveEncodedFile: resolveEncodedFile,
};
