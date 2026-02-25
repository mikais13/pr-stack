import { serve } from "bun";
import app from "./api/index";

serve({
	fetch: app.fetch,
	port: Number(process.env.PORT ?? 8080),
});
