import { type Context, Hono } from "hono";
import { githubApp } from "../../core/github/app";

const webhook = new Hono();

webhook.post("/", async (c: Context) => {
	const signature = c.req.header("x-hub-signature-256") ?? "";
	const eventName = c.req.header("x-github-event") ?? "";
	const deliveryId = c.req.header("x-github-delivery") ?? "";
	const rawBody = await c.req.text();

	try {
		await githubApp.webhooks.verifyAndReceive({
			id: deliveryId,
			name: eventName,
			signature,
			payload: rawBody,
		});
		return c.status(200);
	} catch {
		return c.status(401);
	}
});

export default webhook;
