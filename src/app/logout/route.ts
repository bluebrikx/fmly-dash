import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/admin-auth";

// GET /logout -- clears the session cookie and returns to the sign-in page.
// A plain URL (not only the in-page button) so you can reset the session from
// any state, including the error screens that render no header. Signing out
// is harmless to trigger, so GET is acceptable here; sessions also expire on
// their own after 12 hours, and changing ADMIN_TOKEN revokes every session.
export const dynamic = "force-dynamic";

export async function GET() {
  (await cookies()).delete({ name: COOKIE_NAME, path: "/" });
  redirect("/");
}
