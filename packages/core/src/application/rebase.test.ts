import { mock } from "bun:test";

// Mock auth before importing the module under test — getInstallationArtifacts
// reads env vars at call time, which are unavailable in tests.
mock.module("../github/auth", () => ({
	getInstallationArtifacts: async () => ({
		octokit: mockOctokit,
		token: "fake-token",
	}),
}));

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Deque } from "@datastructures-js/deque";
import { $ } from "bun";
import type { Octokit } from "octokit";
import { PullRequest } from "../models/pull-request.model";
import { GitService } from "../services/git.service";
import { OctokitService } from "../services/octokit.service";
import { cascadeRebase, startRebases } from "./rebase";

const LABEL = "pr-stack:auto-rebase";

const mockOctokit = {
	rest: {
		pulls: {
			update: mock(async () => {}),
		},
	},
};

function makeWorkItem(
	sourceRef: string,
	rebaseOnto: string,
	sourceRefSHA = "old-sha",
) {
	return { sourceRef, sourceRefSHA, rebaseOnto };
}

function makePR(
	number: number,
	head: string,
	base: string,
	labels: string[] = [LABEL],
) {
	return new PullRequest(number, base, head, labels);
}

function makeMockGitService(overrides: Partial<GitService> = {}): GitService {
	return {
		fetchAndGetSHA: mock(async () => "old-head-sha"),
		rebase: mock(async () => ""),
		push: mock(async () => {}),
		abortRebase: mock(async () => {}),
		cloneRepo: mock(async () => {}),
		...overrides,
	} as unknown as GitService;
}

function makeShellError(stderr: string) {
	const err = Object.create($.ShellError.prototype);
	Object.defineProperty(err, "stderr", { value: Buffer.from(stderr) });
	Object.defineProperty(err, "message", { value: stderr });
	return err as InstanceType<typeof $.ShellError>;
}

function makeMockGithubService(
	getPRs: (base: string) => PullRequest[],
): OctokitService {
	return {
		getPullRequestsByBase: mock(async (base: string) => getPRs(base)),
	} as unknown as OctokitService;
}

function makeMockOctokit(updateFn?: () => Promise<void>): Octokit {
	return {
		rest: {
			pulls: {
				update: mock(updateFn ?? (async () => {})),
			},
		},
	} as unknown as Octokit;
}

function makeInput() {
	return {
		repository: {
			name: "repo",
			full_name: "owner/repo",
			owner: { login: "owner" },
		},
		pull_request: {
			number: 1,
			state: "open",
			title: "My PR",
			head: { label: "owner:feat", ref: "feat", sha: "head-sha" },
			base: { label: "owner:main", ref: "main", sha: "base-sha" },
		},
	};
}

describe("startRebases", () => {
	let cloneRepoSpy: ReturnType<typeof spyOn<GitService, "cloneRepo">>;
	let fetchAndGetSHASpy: ReturnType<typeof spyOn<GitService, "fetchAndGetSHA">>;
	let rebaseSpy: ReturnType<typeof spyOn<GitService, "rebase">>;
	let pushSpy: ReturnType<typeof spyOn<GitService, "push">>;
	let abortRebaseSpy: ReturnType<typeof spyOn<GitService, "abortRebase">>;
	let getPRsByBaseSpy: ReturnType<
		typeof spyOn<OctokitService, "getPullRequestsByBase">
	>;

	afterEach(() => {
		cloneRepoSpy.mockRestore();
		fetchAndGetSHASpy.mockRestore();
		rebaseSpy.mockRestore();
		pushSpy.mockRestore();
		abortRebaseSpy.mockRestore();
		getPRsByBaseSpy.mockRestore();
		(mockOctokit.rest.pulls.update as ReturnType<typeof mock>).mockReset();
	});

	it("clones the repo and completes when no dependent PRs are found", async () => {
		cloneRepoSpy = spyOn(GitService.prototype, "cloneRepo").mockResolvedValue(
			undefined,
		);
		fetchAndGetSHASpy = spyOn(
			GitService.prototype,
			"fetchAndGetSHA",
		).mockResolvedValue("old-sha");
		rebaseSpy = spyOn(GitService.prototype, "rebase").mockResolvedValue("");
		pushSpy = spyOn(GitService.prototype, "push").mockResolvedValue(undefined);
		abortRebaseSpy = spyOn(
			GitService.prototype,
			"abortRebase",
		).mockResolvedValue(undefined);
		getPRsByBaseSpy = spyOn(
			OctokitService.prototype,
			"getPullRequestsByBase",
		).mockResolvedValue([]);

		await startRebases(makeInput());

		expect(cloneRepoSpy).toHaveBeenCalledTimes(1);
		expect(cloneRepoSpy).toHaveBeenCalledWith(
			"https://github.com/owner/repo.git",
			{ bare: false },
		);
	});

	it("throws when cloneRepo fails", async () => {
		cloneRepoSpy = spyOn(GitService.prototype, "cloneRepo").mockRejectedValue(
			new Error("clone error"),
		);
		fetchAndGetSHASpy = spyOn(
			GitService.prototype,
			"fetchAndGetSHA",
		).mockResolvedValue("old-sha");
		rebaseSpy = spyOn(GitService.prototype, "rebase").mockResolvedValue("");
		pushSpy = spyOn(GitService.prototype, "push").mockResolvedValue(undefined);
		abortRebaseSpy = spyOn(
			GitService.prototype,
			"abortRebase",
		).mockResolvedValue(undefined);
		getPRsByBaseSpy = spyOn(
			OctokitService.prototype,
			"getPullRequestsByBase",
		).mockResolvedValue([]);

		expect(startRebases(makeInput())).rejects.toThrow("clone error");
	});

	it("throws when cascadeRebase fails due to a rebase conflict", async () => {
		const pr = new PullRequest(2, "feat", "head-sha-pr", [LABEL]);
		cloneRepoSpy = spyOn(GitService.prototype, "cloneRepo").mockResolvedValue(
			undefined,
		);
		fetchAndGetSHASpy = spyOn(
			GitService.prototype,
			"fetchAndGetSHA",
		).mockResolvedValue("old-sha");
		rebaseSpy = spyOn(GitService.prototype, "rebase").mockRejectedValue(
			new Error("conflict"),
		);
		pushSpy = spyOn(GitService.prototype, "push").mockResolvedValue(undefined);
		abortRebaseSpy = spyOn(
			GitService.prototype,
			"abortRebase",
		).mockResolvedValue(undefined);
		getPRsByBaseSpy = spyOn(
			OctokitService.prototype,
			"getPullRequestsByBase",
		).mockResolvedValue([pr]);

		expect(startRebases(makeInput())).rejects.toThrow("PR(s) failed");
	});
});

describe("cascadeRebase", () => {
	let gitService: GitService;
	let octokit: Octokit;

	beforeEach(() => {
		gitService = makeMockGitService();
		octokit = makeMockOctokit();
	});

	it("rebases a single eligible PR", async () => {
		const pr = makePR(1, "feat", "main");
		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).toHaveBeenCalledTimes(1);
		expect(gitService.push).toHaveBeenCalledTimes(1);
		expect(octokit.rest.pulls.update).toHaveBeenCalledTimes(1);
	});

	it("skips PRs without the opt-in label", async () => {
		const pr = makePR(1, "feat", "main", []); // no label
		const githubService = makeMockGithubService(() => [pr]);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).not.toHaveBeenCalled();
		expect(gitService.push).not.toHaveBeenCalled();
	});

	it("rebases only labeled PRs when mixed", async () => {
		const prs = [
			makePR(1, "feat-a", "main", [LABEL]),
			makePR(2, "feat-b", "main", []),
			makePR(3, "feat-c", "main", [LABEL]),
		];
		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? prs : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).toHaveBeenCalledTimes(2);
	});

	it("queues dependents of a successfully rebased PR", async () => {
		const prA = makePR(1, "feat-a", "main");
		const prB = makePR(2, "feat-b", "feat-a");

		const githubService = makeMockGithubService((base) => {
			if (base === "merged-branch") return [prA];
			if (base === "feat-a") return [prB];
			return [];
		});
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).toHaveBeenCalledTimes(2);
	});

	it("does not queue dependents of a failed PR", async () => {
		const prA = makePR(1, "feat-a", "main");
		const prB = makePR(2, "feat-b", "feat-a");

		(gitService.rebase as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw new Error("conflict");
			},
		);

		const githubService = makeMockGithubService((base) => {
			if (base === "merged-branch") return [prA];
			if (base === "feat-a") return [prB];
			return [];
		});
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("#1");

		// PR B should never be rebased since PR A failed
		expect(gitService.rebase).toHaveBeenCalledTimes(1);
		// plain Error — not a ShellError — so abortRebase must not be called
		expect(gitService.abortRebase).not.toHaveBeenCalled();
	});

	it("throws with all failed PR numbers after processing all items", async () => {
		const pr1 = makePR(1, "feat-a", "main");
		const pr2 = makePR(2, "feat-b", "main");

		(gitService.rebase as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw new Error("conflict");
			},
		);

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr1, pr2] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("2 PR(s) failed");
	});

	it("fails when push throws and logs that remote is unchanged", async () => {
		const consoleErrorSpy = spyOn(console, "error");
		const pr = makePR(1, "feat", "main");
		(gitService.push as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw new Error("push rejected");
			},
		);

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("1 PR(s) failed");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringMatching(/git push failed.*Remote is unchanged/),
			}),
		);
		consoleErrorSpy.mockRestore();
	});

	it("fails when GitHub base update throws and logs that manual update is required", async () => {
		const consoleErrorSpy = spyOn(console, "error");
		const pr = makePR(1, "feat", "main");
		octokit = makeMockOctokit(async () => {
			throw new Error("API error");
		});

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("1 PR(s) failed");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringMatching(
					/GitHub base update FAILED.*Manual update/s,
				),
			}),
		);
		consoleErrorSpy.mockRestore();
	});

	it("returns immediately for an empty queue", async () => {
		const githubService = makeMockGithubService(() => []);
		const queue = new Deque<{
			sourceRef: string;
			sourceRefSHA: string;
			rebaseOnto: string;
		}>([]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).not.toHaveBeenCalled();
	});

	it("drains queue when no dependent PRs are found", async () => {
		const githubService = makeMockGithubService(() => []);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).not.toHaveBeenCalled();
	});

	it("calls abortRebase and extracts conflict files (Merge conflict in pattern)", async () => {
		const consoleErrorSpy = spyOn(console, "error");
		const pr = makePR(1, "feat", "main");
		(gitService.rebase as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw makeShellError(
					"Auto-merging src/index.ts\n" +
						"CONFLICT (content): Merge conflict in src/index.ts\n" +
						"CONFLICT (content): Merge conflict in lib/utils.ts\n" +
						"Automatic merge failed; fix conflicts and then commit the result.",
				);
			},
		);

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("1 PR(s) failed");

		expect(gitService.abortRebase).toHaveBeenCalledTimes(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringContaining("2 file(s)"),
			}),
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringContaining("src/index.ts"),
			}),
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringContaining("lib/utils.ts"),
			}),
		);
		consoleErrorSpy.mockRestore();
	});

	it("extracts conflict files using modify/delete pattern", async () => {
		const consoleErrorSpy = spyOn(console, "error");
		const pr = makePR(1, "feat", "main");
		(gitService.rebase as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw makeShellError(
					"CONFLICT (modify/delete): README.md deleted in HEAD and modified in feat",
				);
			},
		);

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("1 PR(s) failed");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringContaining("README.md"),
			}),
		);
		consoleErrorSpy.mockRestore();
	});

	it("extracts conflict files from mixed CONFLICT patterns", async () => {
		const consoleErrorSpy = spyOn(console, "error");
		const pr = makePR(1, "feat", "main");
		(gitService.rebase as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw makeShellError(
					"CONFLICT (content): Merge conflict in src/app.ts\n" +
						"CONFLICT (modify/delete): docs/guide.md deleted in HEAD and modified in feat",
				);
			},
		);

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("1 PR(s) failed");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringContaining("src/app.ts"),
			}),
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("FAILED"),
			expect.objectContaining({
				message: expect.stringContaining("docs/guide.md"),
			}),
		);
		consoleErrorSpy.mockRestore();
	});

	it("throws immediately when fetchAndGetSHA fails (not accumulated)", async () => {
		const pr = makePR(1, "feat", "main");
		(gitService.fetchAndGetSHA as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw new Error("fetch failed");
			},
		);

		const githubService = makeMockGithubService((base) =>
			base === "merged-branch" ? [pr] : [],
		);
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await expect(
			cascadeRebase(queue, gitService, githubService, octokit, "owner", "repo"),
		).rejects.toThrow("fetch failed");

		expect(gitService.rebase).not.toHaveBeenCalled();
	});

	it("cascades rebase through three levels (A → B → C)", async () => {
		const prA = makePR(1, "feat-a", "main");
		const prB = makePR(2, "feat-b", "feat-a");
		const prC = makePR(3, "feat-c", "feat-b");

		const githubService = makeMockGithubService((base) => {
			if (base === "merged-branch") return [prA];
			if (base === "feat-a") return [prB];
			if (base === "feat-b") return [prC];
			return [];
		});
		const queue = new Deque([makeWorkItem("merged-branch", "main")]);

		await cascadeRebase(
			queue,
			gitService,
			githubService,
			octokit,
			"owner",
			"repo",
		);

		expect(gitService.rebase).toHaveBeenCalledTimes(3);
		expect(octokit.rest.pulls.update).toHaveBeenCalledTimes(3);
	});
});
