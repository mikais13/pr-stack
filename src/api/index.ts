import { Hono } from "hono";
import ci from "./routes/ci-check";
import webhook from "./routes/webhook";

// Register webhook handlers
import "../core/github/handlers/on-pr-merged";

const app = new Hono();

app.route("/ci-check", ci);
app.route("/webhook", webhook);
app.get("/", (c) => {
	console.log("Received request to /");
	return c.text("Hello, World!");
});

export default app;
