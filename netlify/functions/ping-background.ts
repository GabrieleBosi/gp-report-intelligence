import type { Config, Context } from "@netlify/functions";
import { withAccess } from "../lib/access.ts";

// Proves background invocation works on the deployed site before the pipeline depends on it (ADR-0002).
export default withAccess(async (_req: Request, context: Context) => {
  console.log(JSON.stringify({ level: "info", fn: "ping-background", deployId: context.deploy.id, msg: "background invocation ran" }));
});

// Per-IP limit (SPEC-public-release W2): a refused request still costs an invocation.
export const config: Config = {
  path: "/api/ping-background", background: true,
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 },
};
