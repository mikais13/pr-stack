import { Hono } from "hono";
import ci from "./routes/ci-check";
import health from "./routes/health";
import webhook from "./routes/webhook";

const app = new Hono();

app.route("/ci-check", ci);
app.route("/webhook", webhook);
app.route("/health", health);

export default app;
