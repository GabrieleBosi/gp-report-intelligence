import type { Context } from "@netlify/functions";
import { hasAccess } from "../../core/access.ts";
import { json } from "./http.ts";

// Wraps every function that has a URL (SPEC-public-release W2): without the owner's key it answers 401 before the
// function reads any other configuration, so no database, storage or model client is ever created for the request.
export function withAccess<R>(handler: (req: Request, context: Context) => R): (req: Request, context: Context) => R | Response {
  return (req, context) => {
    if (hasAccess(req.headers.get("authorization"), Netlify.env.get("LIVE_ACCESS_KEY"))) return handler(req, context);
    const refused = json({ error: "This needs the owner's access key. The public site reads a recorded snapshot." }, 401);
    refused.headers.set("www-authenticate", "Bearer");
    return refused;
  };
}
