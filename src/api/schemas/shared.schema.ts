import { z } from "zod";

export const commitSchema = z.object({
	id: z.string(),
	message: z.string(),
	treeId: z.string(),
	distinct: z.boolean(),
	url: z.string(),
});

export const branchRefSchema = z.object({
	label: z.string(),
	ref: z.string(),
	sha: z.string(),
});

export const pullRequestSchema = z.object({
	number: z.number(),
	state: z.string(),
	title: z.string(),
	head: branchRefSchema,
	base: branchRefSchema,
});

export const repositorySchema = z.object({
	name: z.string(),
	full_name: z.string(),
	owner: z.object({ login: z.string() }),
});
