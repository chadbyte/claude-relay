#!/usr/bin/env node
// Verify that every relative ES module import under lib/public/ resolves to
// an existing file. Catches accidentally-included imports that point at
// files which don't exist in this branch (e.g. PR #342 imported
// './agent-picker.js', which would have broken the client at runtime).
//
// Scope: only checks relative imports (./ or ../). Bare specifiers and
// absolute URLs are ignored — those are not what this guard is about.
//
// Exit code 0 on success, 1 on any unresolved import.

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', 'lib', 'public');

function walk(dir, out) {
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Match `import ... from '...'`, `import '...'`, and `export ... from '...'`.
// Skips dynamic import() — those can take runtime expressions and aren't
// reliably resolvable statically.
var IMPORT_RE = /(?:^|\s)(?:import|export)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g;

function extractSpecifiers(src) {
  var specs = [];
  var m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../');
}

function resolveTarget(fromFile, spec) {
  var base = path.resolve(path.dirname(fromFile), spec);
  // Exact path as written.
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  // Try with .js appended (some imports may omit the extension).
  if (fs.existsSync(base + '.js')) return base + '.js';
  // Directory with index.js.
  var idx = path.join(base, 'index.js');
  if (fs.existsSync(idx)) return idx;
  return null;
}

var files = walk(ROOT, []);
var errors = [];

for (var i = 0; i < files.length; i++) {
  var file = files[i];
  var src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    errors.push({ file: file, spec: '<read error>', detail: e.message });
    continue;
  }
  var specs = extractSpecifiers(src);
  for (var j = 0; j < specs.length; j++) {
    var spec = specs[j];
    if (!isRelative(spec)) continue;
    var target = resolveTarget(file, spec);
    if (!target) {
      errors.push({
        file: path.relative(process.cwd(), file),
        spec: spec,
        detail: 'unresolved relative import',
      });
    }
  }
}

if (errors.length) {
  console.error('Unresolved client imports:');
  for (var k = 0; k < errors.length; k++) {
    var err = errors[k];
    console.error('  ' + err.file + ' -> ' + err.spec + '  (' + err.detail + ')');
  }
  console.error('\nTotal: ' + errors.length + ' unresolved import(s).');
  process.exit(1);
}

console.log('OK: all ' + files.length + ' client modules have resolvable relative imports.');
