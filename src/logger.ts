import { promises as fs } from "fs";
import { TransactionResult } from "./types";
import { getIsoTimestamp } from "./utils";

export function info(...args) {
	console.log(`[${getIsoTimestamp()}] [INFO]`, ...args);
}

export function warn(...args) {
	console.log(`[${getIsoTimestamp()}] [WARN]`, ...args);
}

export function error(...args) {
	console.log(`[${getIsoTimestamp()}] [ERROR]`, ...args);
}

export interface SimulatedTxLogItem {
	signature: string;
	isoTimestamp: string;
	success: boolean;
}

export interface Logger {
	log(results: TransactionResult[]): Promise<void>;
}

export class FileLogger implements Logger {
	constructor(private readonly filePath: string = "./logs/sim-tx-log.jsonl") {
		fs.mkdir("./logs/", { recursive: true }).catch(() => {});
		fs.access(this.filePath).catch(() =>
			fs.writeFile(this.filePath, "", { encoding: "utf8" })
		);
	}

	async log(results: TransactionResult[]): Promise<void> {
		const lines =
			results
				.map((r) => {
					if (!r.success) {
						console.log(`[LOGGER] error in simulated transaction: ${r.error}`);

						return JSON.stringify({
							signature: r.signature || "n/a",
							isoTimestamp: getIsoTimestamp(),
							success: false,
							computeUnitsConsumed: 0,
							returnData: undefined,
							meta: { err: "n/a" },
						});
					}

					const item: SimulatedTxLogItem = {
						signature: r.signature || "n/a",
						isoTimestamp: getIsoTimestamp(),
						success: true,
					};
					return JSON.stringify(item);
				})
				.join("\n") + "\n";

		await fs.appendFile(this.filePath, lines, { encoding: "utf8" });
	}
}
