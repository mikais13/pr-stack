import { type Context, Hono } from "hono";

const ci = new Hono();

ci.post("/", async (c: Context) => {
	return Promise.resolve(c.text("CI should be skipped."));
});

export default ci;
