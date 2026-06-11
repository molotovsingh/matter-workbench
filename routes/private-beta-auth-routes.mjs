import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute, patternRoute } from "./route-dispatcher.mjs";

export async function handlePrivateBetaAuthApiRequest({ request, requestUrl, response, services }) {
  const { privateBetaAuthService, privateBetaUsersService } = services;
  if (!privateBetaAuthService) return false;

  return dispatchRoutes({
    request,
    requestUrl,
    response,
    routes: [
      exactRoute("GET", "/api/auth/status", async () => {
        sendJson(response, 200, privateBetaAuthService.status(request));
      }),
      exactRoute("POST", "/api/auth/login", async () => {
        const body = await readRequestJson(request, { maxBodyBytes: 16 * 1024 });
        const result = privateBetaAuthService.login(body, { request });
        const headers = { "content-type": "application/json; charset=utf-8" };
        if (result.setCookie) headers["set-cookie"] = result.setCookie;
        response.writeHead(result.statusCode, headers);
        response.end(JSON.stringify(result.payload));
      }),
      exactRoute("POST", "/api/auth/logout", async () => {
        const result = privateBetaAuthService.logout(request);
        const headers = { "content-type": "application/json; charset=utf-8" };
        if (result.setCookie) headers["set-cookie"] = result.setCookie;
        response.writeHead(result.statusCode, headers);
        response.end(JSON.stringify(result.payload));
      }),
      exactRoute("GET", "/api/private-beta/users", async () => {
        if (requireSuperuser({ request, response, privateBetaAuthService })) return;
        sendJson(response, 200, await privateBetaUsersService.listUsers());
      }),
      exactRoute("POST", "/api/private-beta/users", async () => {
        if (requireSuperuser({ request, response, privateBetaAuthService })) return;
        const body = await readRequestJson(request, { maxBodyBytes: 16 * 1024 });
        sendJson(response, 200, await privateBetaUsersService.addTester({
          username: body.username,
          displayName: body.displayName,
        }));
      }),
      patternRoute("POST", /^\/api\/private-beta\/users\/([^/]+)\/reset-password$/, async ({ params }) => {
        if (requireSuperuser({ request, response, privateBetaAuthService })) return;
        sendJson(response, 200, await privateBetaUsersService.resetPassword(decodeURIComponent(params[0] || "")));
      }),
      patternRoute("POST", /^\/api\/private-beta\/users\/([^/]+)\/disable$/, async ({ params }) => {
        if (requireSuperuser({ request, response, privateBetaAuthService })) return;
        sendJson(response, 200, await privateBetaUsersService.setUserDisabled(decodeURIComponent(params[0] || ""), true));
      }),
      patternRoute("POST", /^\/api\/private-beta\/users\/([^/]+)\/enable$/, async ({ params }) => {
        if (requireSuperuser({ request, response, privateBetaAuthService })) return;
        sendJson(response, 200, await privateBetaUsersService.setUserDisabled(decodeURIComponent(params[0] || ""), false));
      }),
    ],
  });
}

function requireSuperuser({ request, response, privateBetaAuthService }) {
  const auth = privateBetaAuthService.status(request);
  if (auth.authenticated && auth.user?.role === "superuser") return false;
  sendJson(response, auth.authenticated ? 403 : 401, {
    error: auth.authenticated ? "Superuser access required" : "Login required",
    authRequired: !auth.authenticated,
  });
  return true;
}

export function requirePrivateBetaAuth({ request, requestUrl, response, services }) {
  const { privateBetaAuthService } = services;
  if (!privateBetaAuthService?.requireAuth()) return false;
  if (!requestUrl.pathname.startsWith("/api/")) return false;
  if (requestUrl.pathname.startsWith("/api/auth/")) return false;
  if (privateBetaAuthService.isAuthenticated(request)) return false;
  sendJson(response, 401, { error: "Login required", authRequired: true });
  return true;
}
