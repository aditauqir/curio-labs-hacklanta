function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function getWorkspaceHostUrl(pathname: string) {
  if (typeof window === "undefined") return null;

  const current = new URL(window.location.href);
  const hostname = current.hostname.toLowerCase();
  if (isLocalHostname(hostname)) return null;

  // Keep the product on the working apex hostname. The former app.
  // subdomain is not part of the production surface and its DNS zone is
  // outside this app's deployment, so generating it made navigation fail
  // before the request could reach Next.js.
  if (hostname.startsWith("app.")) {
    current.hostname = hostname.slice(4);
    current.pathname = pathname;
    current.search = "";
    current.hash = "";
    return current.toString();
  }

  return null;
}
