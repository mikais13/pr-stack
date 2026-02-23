import { type Context, Hono } from "hono";
import { shouldSkipCI } from "../../core/application/ci-check";
import { ciCheckParamsSchema } from "../schemas/ci-check.schema";

const ci = new Hono();

ci.post("/", async (c: Context) => {
	const parsed = ciCheckParamsSchema.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "Invalid parameters" }, 400);
	}
	const result = await shouldSkipCI(parsed.data);
	return c.json(result, 200);
});

export default ci;
