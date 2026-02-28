export class PullRequest {
	private number: number;
	private base: string;
	private head: string;
	private labels: string[];

	constructor(number: number, base: string, head: string, labels: string[]) {
		this.number = number;
		this.base = base;
		this.head = head;
		this.labels = labels;
	}

	public getNumber(): number {
		return this.number;
	}

	public getBase(): string {
		return this.base;
	}

	public getHead(): string {
		return this.head;
	}

	public getLabels(): string[] {
		return this.labels;
	}
}
