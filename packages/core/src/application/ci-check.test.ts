import { mock } from "bun:test";

// Mock auth here — it is test-specific behaviour.
mock.module("../github/auth", () => ({
	getInstallationArtifacts: async () => ({ octokit: {}, token: "fake-token" }),
}));

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Commit } from "../models/commit.model";
import { GitService } from "../services/git.service";
import { OctokitService } from "../services/octokit.service";
import { shouldSkipCI } from "./ci-check";

function makeCommit(sha: string, treeSHA: string) {
	return new Commit(sha, treeSHA);
}

function makeParams(
	overrides: {
		before?: string;
		after?: string;
		headSha?: string;
		baseSha?: string;
	} = {},
) {
	const headSha = overrides.headSha ?? "head-sha";
	return {
		before: overrides.before ?? "before-sha",
		after: overrides.after ?? headSha,
		repository: {
			name: "repo",
			full_name: "owner/repo",
			owner: { login: "owner" },
		},
		pull_request: {
			number: 1,
			state: "open",
			title: "My PR",
			head: { label: "owner:feat", ref: "feat", sha: headSha },
			base: {
				label: "owner:main",
				ref: "main",
				sha: overrides.baseSha ?? "base-sha",
			},
		},
	};
}

describe("shouldSkipCI", () => {
	let getCommitSpy: ReturnType<typeof spyOn<OctokitService, "getCommit">>;
	let cloneRepoSpy: ReturnType<typeof spyOn<GitService, "cloneRepo">>;
	let traverseToSHASpy: ReturnType<typeof spyOn<GitService, "traverseToSHA">>;

	beforeEach(() => {
		// Default: two commits with the same tree SHA (skip CI scenario)
		getCommitSpy = spyOn(
			OctokitService.prototype,
			"getCommit",
		).mockImplementation(async (sha: string) =>
			sha === "before-sha"
				? makeCommit("before-sha", "same-tree")
				: makeCommit("head-sha", "same-tree"),
		);
		cloneRepoSpy = spyOn(GitService.prototype, "cloneRepo").mockResolvedValue(
			undefined,
		);
		traverseToSHASpy = spyOn(
			GitService.prototype,
			"traverseToSHA",
		).mockResolvedValue([makeCommit("head-sha", "same-tree")]);
	});

	afterEach(() => {
		getCommitSpy.mockRestore();
		cloneRepoSpy.mockRestore();
		traverseToSHASpy.mockRestore();
	});

	it("returns skipCI: false early when after !== head.sha", async () => {
		const params = makeParams({ after: "different-sha", headSha: "head-sha" });

		const result = await shouldSkipCI(params);

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/does not match head SHA/);
		expect(cloneRepoSpy).not.toHaveBeenCalled();
	});

	it("returns skipCI: false when before commit is not found", async () => {
		getCommitSpy.mockImplementation(async (sha: string) =>
			sha === "before-sha" ? null : makeCommit("head-sha", "tree-a"),
		);

		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/Could not retrieve commits/);
	});

	it("returns skipCI: false when after commit is not found", async () => {
		getCommitSpy.mockImplementation(async (sha: string) =>
			sha === "before-sha" ? makeCommit("before-sha", "tree-a") : null,
		);

		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/Could not retrieve commits/);
	});

	it("returns skipCI: false when clone fails", async () => {
		cloneRepoSpy.mockRejectedValue(new Error("clone error"));

		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/Failed to clone/);
	});

	it("returns skipCI: false when traverseToSHA returns null", async () => {
		traverseToSHASpy.mockResolvedValue(null);

		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/Failed to traverse/);
	});

	it("returns skipCI: false when before SHA is an ancestor of head", async () => {
		traverseToSHASpy.mockResolvedValue([
			makeCommit("head-sha", "same-tree"),
			makeCommit("before-sha", "same-tree"),
		]);

		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/is an ancestor/);
	});

	it("returns skipCI: false when tree SHAs differ", async () => {
		getCommitSpy.mockImplementation(async (sha: string) =>
			sha === "before-sha"
				? makeCommit("before-sha", "tree-old")
				: makeCommit("head-sha", "tree-new"),
		);

		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(false);
		expect(result.message).toMatch(/does not match after commit tree SHA/);
	});

	it("returns skipCI: true when tree SHAs match and before is not an ancestor", async () => {
		const result = await shouldSkipCI(makeParams());

		expect(result.skipCI).toBe(true);
		expect(result.message).toMatch(/No changes detected/);
	});
});
