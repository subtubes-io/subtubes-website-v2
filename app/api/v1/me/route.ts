import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { error: "unauthorized", message: "Authentication required." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const memberships = await db
    .selectFrom("member")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .where("member.userId", "=", session.user.id)
    .select([
      "organization.id",
      "organization.name",
      "organization.slug",
      "organization.logo",
      "organization.createdAt",
      "member.role",
    ])
    .orderBy("organization.name", "asc")
    .execute();

  const user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    image: session.user.image ?? null,
    username: (session.user as { username?: string | null }).username ?? null,
    displayUsername: (session.user as { displayUsername?: string | null }).displayUsername ?? null,
  };

  const organizations = memberships.map((membership) => ({
    id: membership.id,
    name: membership.name,
    slug: membership.slug,
    logo: membership.logo,
    role: membership.role,
    createdAt: membership.createdAt instanceof Date ? membership.createdAt.toISOString() : membership.createdAt,
  }));

  return Response.json(
    { user, organizations },
    {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
