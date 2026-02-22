export class Commit {
	private sha: string;
	private treeSHA: string;
	private parents: Commit[];

	constructor(sha: string, treeSHA: string, parents?: Commit[]) {
		this.sha = sha;
		this.treeSHA = treeSHA;
		this.parents = parents ? parents : [];
	}

	public getSHA(): string {
		return this.sha;
	}

	public getTreeSHA(): string {
		return this.treeSHA;
	}

	public getParents(): Commit[] {
		return [...this.parents];
	}

	public addParent(parent: Commit): void {
		this.parents.push(parent);
	}
}
