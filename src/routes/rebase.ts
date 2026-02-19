import { type Context, Hono } from "hono";

const rebase = new Hono();

rebase.post("/", async (c: Context) => {
	return Promise.resolve(c.text("Rebase successful!"));
});

export default rebase;
