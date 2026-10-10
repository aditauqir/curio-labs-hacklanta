export function isAppHostname(hostname: string) {
  return hostname.split(":", 1)[0].toLowerCase().startsWith("app.");
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function getWorkspaceHostUrl(pathname: string) {
  if (typeof window === "undefined") return null;

  const current = new URL(window.location.href);
  const hostname = current.hostname.toLowerCase();
  if (isLocalHostname(hostname)) return null;

  if (isAppHostname(hostname)) {
    if (pathname !== "/home") return null;
    current.hostname = hostname.slice(4);
    current.pathname = pathname;
    current.search = "";
    current.hash = "";
    return current.toString();
  }

  if (pathname === "/home") return null;

  current.hostname = `app.${hostname.startsWith("www.") ? hostname.slice(4) : hostname}`;
  current.pathname = pathname;
  current.search = "";
  current.hash = "";
  return current.toString();
}
