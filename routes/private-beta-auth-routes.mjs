import { readRequestJson, sendJson } from "./http-utils.mjs";
import { dispatchRoutes, exactRoute } from "./route-dispatcher.mjs";

export async function handlePrivateBetaAuthApiRequest({ request, requestUrl, response, services }) {
  const { privateBetaAuthService } = services;
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
        const result = privateBetaAuthService.login(body);
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
    ],
  });
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
