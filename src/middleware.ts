import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/platform(.*)",
  "/chat(.*)",
  "/permissions(.*)",
  "/setup(.*)",
  "/store(.*)",
  "/store-v2(.*)",
  "/reservations(.*)",
  "/knowledge(.*)",
  "/faq(.*)",
  "/talk-scripts(.*)",
  "/ng-answers(.*)",
  "/notification-logs(.*)",
  "/sales(.*)",
  "/therapist(.*)",
  "/customer(.*)",
  "/ops(.*)",
  "/phone-ai(.*)",
  "/api/admin/(.*)",
  "/api/platform/(.*)",
  "/api/permissions/(.*)",
  "/api/audit-logs(.*)",
  "/api/blocked-slots(.*)",
  "/api/call-logs(.*)",
  "/api/conversations(.*)",
  "/api/courses(.*)",
  "/api/customers(.*)",
  "/api/debug/(.*)",
  "/api/escalations(.*)",
  "/api/faq(.*)",
  "/api/holds(.*)",
  "/api/knowledge(.*)",
  "/api/ng-answers(.*)",
  "/api/notifications(.*)",
  "/api/reservations(.*)",
  "/api/rooms(.*)",
  "/api/sales(.*)",
  "/api/setup/checklist(.*)",
  "/api/store-profile(.*)",
  "/api/store-import(.*)",
  "/api/shifts(.*)",
  "/api/store-phone-settings(.*)",
  "/api/store-usage(.*)",
  "/api/therapists(.*)"
]);

const isPublicAutomationRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/",
  "/api/ai/reception",
  "/api/ai/extract",
  "/api/line/webhook",
  "/api/twilio/(.*)",
  "/api/health",
  "/api/reminders/run"
]);

function isClerkConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

function isProductionLike() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function authProviderNotConfiguredResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "auth provider not configured" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  return new NextResponse("auth provider not configured", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

const protectedMiddleware = clerkMiddleware(async (auth, request) => {
  if (isPublicAutomationRoute(request)) return NextResponse.next();
  if (isProtectedRoute(request) && request.nextUrl.pathname.startsWith("/api/")) {
    const authState = await auth();
    if (!authState.userId) {
      return NextResponse.json(
        { error: "Authentication is required." },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store"
          }
        }
      );
    }
    return NextResponse.next();
  }
  if (isProtectedRoute(request)) await auth.protect({ unauthenticatedUrl: new URL("/sign-in", request.url).toString() });
  return NextResponse.next();
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const localUiTestBypass =
    process.env.ARARE_LOCAL_UI_TEST === "1" &&
    ["127.0.0.1", "localhost", "::1"].includes(request.nextUrl.hostname);
  if (localUiTestBypass) return NextResponse.next();

  if (!isClerkConfigured()) {
    if (isProductionLike()) return authProviderNotConfiguredResponse(request);
    return NextResponse.next();
  }

  return protectedMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/api/(.*)"]
};
