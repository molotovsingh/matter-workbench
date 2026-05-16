import assert from "node:assert/strict";
import test from "node:test";

import { dispatchRoutes, exactRoute, patternRoute } from "../routes/route-dispatcher.mjs";

test("dispatchRoutes runs the matching exact method and path", async () => {
  const calls = [];
  const handled = await dispatchRoutes({
    request: { method: "GET" },
    requestUrl: new URL("http://local.test/api/example"),
    response: {},
    routes: [
      exactRoute("POST", "/api/example", async () => calls.push("wrong-method")),
      exactRoute("GET", "/api/example", async () => calls.push("matched")),
      exactRoute("GET", "/api/other", async () => calls.push("wrong-path")),
    ],
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["matched"]);
});

test("dispatchRoutes passes regex captures to pattern route handlers", async () => {
  let params = null;
  const handled = await dispatchRoutes({
    request: { method: "POST" },
    requestUrl: new URL("http://local.test/api/skill-ideas/idea%201/status"),
    response: {},
    routes: [
      patternRoute("POST", /^\/api\/skill-ideas\/([^/]+)\/status$/, async (context) => {
        params = context.params;
      }),
    ],
  });

  assert.equal(handled, true);
  assert.deepEqual(params, ["idea%201"]);
});

test("dispatchRoutes returns false when no route matches", async () => {
  const handled = await dispatchRoutes({
    request: { method: "DELETE" },
    requestUrl: new URL("http://local.test/api/example"),
    response: {},
    routes: [
      exactRoute("GET", "/api/example", async () => {
        throw new Error("should not run");
      }),
    ],
  });

  assert.equal(handled, false);
});
