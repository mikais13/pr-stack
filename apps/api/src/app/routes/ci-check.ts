import { ciCheckParamsSchema, shouldSkipCI } from "@pr-stack/core";
import { type Context, Hono } from "hono";

const ci = new Hono();

ci.post("/", async (c: Context) => {
	const parsed = ciCheckParamsSchema.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "Invalid parameters" }, 400);
	}
	try {
		const result = await shouldSkipCI(parsed.data);
		return c.json(result, 200);
	} catch (err) {
		console.error("ci-check error:", err);
		return c.json(
			{ skipCI: false, message: "CI check failed, proceeding with CI" },
			500,
		);
	}
});

export default ci;
