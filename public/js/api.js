async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body && !(options.body instanceof ArrayBuffer)
      ? { "Content-Type": "application/json", ...(options.headers || {}) }
      : options.headers,
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/index.html";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
  const contentType = res.headers.get("Content-Type") || "";
  return contentType.includes("application/json") ? res.json() : res;
}

async function requireLogin() {
  try {
    return await api("/auth/me");
  } catch {
    window.location.href = "/index.html";
    throw new Error("redirecting");
  }
}
