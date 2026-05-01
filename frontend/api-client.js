export async function getJson(url) {
  const response = await fetch(url);
  return parseJsonResponse(response, url);
}

export async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, url);
}

export async function patchJson(url, body = {}) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, url);
}

async function parseJsonResponse(response, label) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response; error below includes status.
  }
  if (!response.ok) {
    throw new Error(payload?.error || `${label} returned ${response.status}`);
  }
  return payload;
}
