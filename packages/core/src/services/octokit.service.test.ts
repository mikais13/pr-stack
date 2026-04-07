import { describe, expect, it, mock } from "bun:test";
import type { Octokit } from "octokit";
import { Commit } from "../models/commit.model";
import { PullRequest } from "../models/pull-request.model";
import { OctokitService } from "./octokit.service";

function makeMockOctokit(overrides: {
	getCommit?: ReturnType<typeof mock>;
	listPulls?: ReturnType<typeof mock>;
}): Octokit {
	return {
		rest: {
			git: {
				getCommit:
					overrides.getCommit ??
					mock(async () => ({
						status: 200,
						data: { tree: { sha: "tree-abc" } },
					})),
			},
			pulls: {
				list:
					overrides.listPulls ?? mock(async () => ({ status: 200, data: [] })),
			},
		},
	} as unknown as Octokit;
}

describe("OctokitService.getCommit", () => {
	it("returns a Commit with correct SHA and tree SHA on 200", async () => {
		const octokit = makeMockOctokit({
			getCommit: mock(async () => ({
				status: 200,
				data: { tree: { sha: "tree-abc" } },
			})),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		const result = await service.getCommit("sha-123");

		expect(result).toBeInstanceOf(Commit);
		expect(result?.getSHA()).toBe("sha-123");
		expect(result?.getTreeSHA()).toBe("tree-abc");
	});

	it("returns null on non-200 status", async () => {
		const octokit = makeMockOctokit({
			getCommit: mock(async () => ({ status: 404 })),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		const result = await service.getCommit("sha-404");

		expect(result).toBeNull();
	});

	it("returns null when the API throws", async () => {
		const octokit = makeMockOctokit({
			getCommit: mock(async () => {
				throw new Error("network error");
			}),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		const result = await service.getCommit("sha-err");

		expect(result).toBeNull();
	});
});

describe("OctokitService.getPullRequestsByBase", () => {
	it("maps API response to PullRequest models", async () => {
		const octokit = makeMockOctokit({
			listPulls: mock(async () => ({
				status: 200,
				data: [
					{
						number: 1,
						base: { ref: "main" },
						head: { ref: "feat" },
						labels: [{ name: "bug" }],
					},
				],
			})),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		const result = await service.getPullRequestsByBase("main", "open");
		expect(result).not.toBeEmpty();
		const first = result[0];

		expect(first).toBeDefined();
		if (!first) return; // Narrow the type
		expect(result).toHaveLength(1);
		expect(first).toBeInstanceOf(PullRequest);
		expect(first.getNumber()).toBe(1);
		expect(first.getBase()).toBe("main");
		expect(first.getHead()).toBe("feat");
		expect(first.getLabels()).toEqual(["bug"]);
	});

	it("returns empty array when no PRs exist", async () => {
		const octokit = makeMockOctokit({
			listPulls: mock(async () => ({ status: 200, data: [] })),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		const result = await service.getPullRequestsByBase("main", "open");

		expect(result).toEqual([]);
	});

	it("maps multiple PRs correctly", async () => {
		const octokit = makeMockOctokit({
			listPulls: mock(async () => ({
				status: 200,
				data: [
					{
						number: 1,
						base: { ref: "main" },
						head: { ref: "feat-a" },
						labels: [],
					},
					{
						number: 2,
						base: { ref: "main" },
						head: { ref: "feat-b" },
						labels: [{ name: "pr-stack:auto-rebase" }],
					},
					{
						number: 3,
						base: { ref: "main" },
						head: { ref: "feat-c" },
						labels: [],
					},
				],
			})),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		const result = await service.getPullRequestsByBase("main", "open");

		expect(result).toHaveLength(3);
		expect(result.map((pr) => pr.getNumber())).toEqual([1, 2, 3]);
	});

	it("throws when API returns non-200", async () => {
		const octokit = makeMockOctokit({
			listPulls: mock(async () => ({ status: 500, data: [] })),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		await expect(service.getPullRequestsByBase("main", "open")).rejects.toThrow(
			"500",
		);
	});

	it("throws when pulls.list rejects with a network error", async () => {
		const octokit = makeMockOctokit({
			listPulls: mock(async () => {
				throw new Error("network error");
			}),
		});
		const service = new OctokitService(octokit, "owner", "repo");

		await expect(service.getPullRequestsByBase("main", "open")).rejects.toThrow(
			"network error",
		);
	});
});
