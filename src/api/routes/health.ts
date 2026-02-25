import { Hono } from "hono";

const health = new Hono();

health.get("/", (c) => {
	return c.text("OK");
});

export default health;
