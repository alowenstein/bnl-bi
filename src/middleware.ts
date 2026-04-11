import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BASIC_USER = process.env.BASIC_AUTH_USER ?? "";
const BASIC_PASS = process.env.BASIC_AUTH_PASS ?? "";

export function middleware(req: NextRequest) {
  // Skip auth if credentials aren't configured (local dev without env vars)
  if (!BASIC_USER || !BASIC_PASS) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(":");
      if (user === BASIC_USER && pass === BASIC_PASS) {
        return NextResponse.next();
      }
    }
  }

  // Return 401 with WWW-Authenticate to trigger browser's native login dialog
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="Builds 'n Lenses BI", charset="UTF-8"`,
    },
  });
}

export const config = {
  // Protect everything — pages and API routes
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
