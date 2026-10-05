// Partsong share relay. PUT /s/<id> stores an encrypted score (AES-GCM, done
// on the phone; the key travels only in the link's #fragment, so this never
// sees it); GET /s/<id> returns it. Ids are random 128-bit values chosen by the
// app; an existing id is never overwritten.

const MAX_BYTES = 40e6; // a long score with many photos is ~10 MB
const MAGIC = "PSR1"; // what the app puts before its ciphertext
const ID = /^[A-Za-z0-9_-]{22}$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ORIGINS.split(",").map((o) => o.trim());
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, PUT",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...cors, ...headers } });
    if (request.method === "OPTIONS") return reply(null, 204);

    const [, kind, id] = new URL(request.url).pathname.split("/");
    if (kind !== "s" || !ID.test(id || "")) return reply("Not found", 404);

    if (request.method === "GET") {
      const obj = await env.SHARES.get(id);
      if (!obj) return reply("Not found", 404);
      return reply(obj.body, 200, { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=86400" });
    }
    if (request.method === "PUT") {
      if (!allowed.includes(origin)) return reply("Forbidden", 403);
      const size = Number(request.headers.get("Content-Length"));
      if (!size || size > MAX_BYTES) return reply("Too large", 413);
      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_BYTES || new TextDecoder().decode(body.slice(0, 4)) !== MAGIC) return reply("Bad request", 400);
      if (await env.SHARES.head(id)) return reply("Exists", 409);
      await env.SHARES.put(id, body);
      return reply(null, 201);
    }
    return reply("Method not allowed", 405);
  },
};
