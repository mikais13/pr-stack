import { z } from "zod";
import { pullRequestSchema, repositorySchema } from "./shared.schema";

export const ciCheckParamsSchema = z.object({
	after: z.string(),
	before: z.string(),
	repository: repositorySchema,
	pull_request: pullRequestSchema,
});

export type CiCheckParams = z.infer<typeof ciCheckParamsSchema>;
