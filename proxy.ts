import { NextResponse, type NextRequest } from "next/server";
import { isAppHostname } from "@/lib/host-routing";

export function proxy(request: NextRequest) {
  if (isAppHostname(request.headers.get("host") ?? "") && request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/app", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
