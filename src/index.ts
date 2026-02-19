import { Hono } from "hono";
import ci from "./routes/ci-check";
import rebase from "./routes/rebase";

const app = new Hono();

app.route("/ci-check", ci);
app.route("/rebase", rebase);

export default app;
