import { connection } from "next/server";

async function notFound() {
  await connection();
  return Response.json({ error: "not_found", message: "No such endpoint." }, {
    status: 404, headers: { "Cache-Control": "no-store" },
  });
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH,
  notFound as DELETE, notFound as OPTIONS, notFound as HEAD };
