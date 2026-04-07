import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Deque } from "@datastructures-js/deque";
import { $ } from "bun";
import type { Octokit } from "octokit";
import { PullRequest } from "../models/pull-request.model";
import type { GitService } from "../services/git.service";
import type { OctokitService } from "../services/octokit.service";
import { cascadeRebase } from "./rebase";

const LABEL = "pr-stack:auto-rebase";

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

	it("fails when push throws", async () => {
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
	});

	it("fails when GitHub base update throws", async () => {
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

	it("calls abortRebase when rebase throws a ShellError", async () => {
		const pr = makePR(1, "feat", "main");
		(gitService.rebase as ReturnType<typeof mock>).mockImplementation(
			async () => {
				throw makeShellError(
					"CONFLICT (content): Merge conflict in src/index.ts",
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
