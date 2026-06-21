import assert from "node:assert/strict";
import test from "node:test";

import { createConsoleEmailSender, renderConsoleCodeEmail } from "../mothership/console-email.mjs";

test("console email sender builds a Resend request without client data", async () => {
  const calls = [];
  const sender = createConsoleEmailSender({
    env: {
      MOTHERSHIP_CONSOLE_EMAIL_PROVIDER: "resend",
      MOTHERSHIP_CONSOLE_EMAIL_API_KEY: "re_test_key",
      MOTHERSHIP_CONSOLE_FROM_EMAIL: "Matter Workbench <mothership@example.test>",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    },
  });

  await sender.sendConsoleCode({ email: "aks@example.test", code: "123456", expiresInMinutes: 10 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, "Bearer re_test_key");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ["aks@example.test"]);
  assert.equal(body.from, "Matter Workbench <mothership@example.test>");
  assert.match(body.subject, /console code/i);
  assert.match(body.text, /123456/);
  assert.doesNotMatch(body.text, /client|feedback|signal|matter name/i, "email body should contain only generic console-code copy");
});

test("console email sender accepts RESEND_API_KEY fallback", () => {
  const sender = createConsoleEmailSender({
    env: {
      RESEND_API_KEY: "re_test_key",
      MOTHERSHIP_CONSOLE_FROM_EMAIL: "Matter Workbench <mothership@example.test>",
    },
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(sender.provider, "resend");
});

test("console email sender fails closed without provider configuration", () => {
  assert.throws(() => createConsoleEmailSender({ env: {} }), /EMAIL_PROVIDER=resend/i);
  assert.throws(
    () => createConsoleEmailSender({ env: { MOTHERSHIP_CONSOLE_EMAIL_PROVIDER: "resend" } }),
    /EMAIL_API_KEY|RESEND_API_KEY/i,
  );
});

test("console code email copy is short and generic", () => {
  const text = renderConsoleCodeEmail({ code: "654321", expiresInMinutes: 7 });
  assert.match(text, /654321/);
  assert.match(text, /expires in 7 minutes/i);
  assert.doesNotMatch(text, /client|matter name|feedback|signal/i);
});
