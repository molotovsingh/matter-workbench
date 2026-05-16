export function exactRoute(method, path, handle) {
  return {
    method: normalizeMethod(method),
    path,
    handle,
  };
}

export function patternRoute(method, pattern, handle) {
  return {
    method: normalizeMethod(method),
    pattern,
    handle,
  };
}

export async function dispatchRoutes({ request, requestUrl, response, routes = [] }) {
  const requestMethod = normalizeMethod(request.method);
  for (const route of routes) {
    if (route.method !== requestMethod) continue;
    const params = matchRoutePath(route, requestUrl.pathname);
    if (!params) continue;
    await route.handle({ request, requestUrl, response, params });
    return true;
  }
  return false;
}

export async function dispatchRouteGroups(context, handlers = []) {
  for (const handler of handlers) {
    if (await handler(context)) return true;
  }
  return false;
}

function matchRoutePath(route, pathname) {
  if (route.path) return route.path === pathname ? [] : null;
  if (!route.pattern) return null;
  const match = pathname.match(route.pattern);
  return match ? match.slice(1) : null;
}

function normalizeMethod(method) {
  return String(method || "").trim().toUpperCase();
}
