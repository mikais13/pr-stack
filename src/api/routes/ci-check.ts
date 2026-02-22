import { type Context, Hono } from "hono";
import { shouldSkipCI } from "../../core/application/ci-check";
import { ciCheckParamsSchema } from "../schemas/ci-check.schema";

const ci = new Hono();

ci.post("/", async (c: Context) => {
	const params = ciCheckParamsSchema.parse(await c.req.json());
	if (!params) {
		return c.json({ error: "Invalid parameters" }, 400);
	}
	const result = await shouldSkipCI(params);
	return c.json(result, 200);
});

export default ci;
