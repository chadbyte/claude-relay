function attachExperimentalSettings(ctx) {
  var users = ctx.users;
  var getMultiUserFromReq = ctx.getMultiUserFromReq;
  var opts = ctx.opts;

  function handleRequest(req, res, fullUrl) {
    if (req.method !== "PUT" || fullUrl !== "/api/user/capsules-enabled") return false;
    var isMultiUser = users.isMultiUser();
    var mu = getMultiUserFromReq(req);
    if (isMultiUser && !mu) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":"unauthorized"}');
      return true;
    }
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try {
        var data = JSON.parse(body);
        var result;
        var userId = "default";
        if (isMultiUser) {
          userId = mu.id;
          result = users.setCapsulesEnabled(userId, data.enabled === true);
        } else if (typeof opts.onSetCapsulesEnabled === "function") {
          result = opts.onSetCapsulesEnabled(data.enabled === true);
        } else {
          result = { ok: true, capsulesEnabled: false };
        }
        if (result.error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        if (typeof ctx.onCapsulesPreferenceChanged === "function") ctx.onCapsulesPreferenceChanged(userId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, capsulesEnabled: result.capsulesEnabled === true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invalid request"}');
      }
    });
    return true;
  }

  return { handleRequest: handleRequest };
}

module.exports = { attachExperimentalSettings: attachExperimentalSettings };
