import WebSocket from "ws";
import { EventEmitter } from "events";
import config from "./config";
import { info, error, warn } from "./logger";
import { getBlockSubscriptionRequest } from "./utils";
import { Address, address, Commitment } from "@solana/kit";
import { TxMessage, TxResponse, ResponseEncoding } from "./types";

export interface CopyTradeMessage {
	type?: string;
	status?: string;
	signer?: string;
	[key: string]: any;
}

export default class CopyEmitter extends EventEmitter {
	private ws: WebSocket | null = null;
	private pingInterval: NodeJS.Timeout | null = null;
	private sourceAddress: Address = address(config.SOURCE_ADDRESS);

	connect(
		commitment: Commitment = "confirmed",
		encoding: ResponseEncoding = "jsonParsed"
	) {
		this.ws = new WebSocket(config.DEVNET_WSS_URL);

		this.ws.on("open", () => {
			this.ws.send(
				getBlockSubscriptionRequest(this.sourceAddress, commitment, encoding)
			);

			info(
				`[WS] subscription request sent for account ${config.SOURCE_ADDRESS}`
			);

			// ping every 30 seconds
			this.pingInterval = setInterval(() => {
				if (this.ws?.readyState === WebSocket.OPEN) {
					this.ws.ping();
				}
			}, 30_000);
		});

		this.ws.on("message", (notificationJson) => {
			try {
				const parsedNotification = JSON.parse(notificationJson);

				if (parsedNotification.method !== "blockNotification") {
					info("[WS] subscriptionId:", parsedNotification.result);
					return;
				}

				if (!parsedNotification.params || !parsedNotification.params.result) {
					info("[WS] no params in notification");
					return;
				}

				// info(
				// 	"first tx accountKeys: \n",
				// 	parsedNotification.params.result.value.block.transactions[0].message
				// 		.accountKeys
				// );

				// TODO properly type this
				const txs: any[] =
					parsedNotification.params.result.value.block.transactions;

				const sourceSignedTxs = txs.filter((tx) =>
					tx.transaction.message.accountKeys.some(
						(k) => k.signer && k.pubkey === config.SOURCE_ADDRESS
					)
				);

				if (sourceSignedTxs.length === 0)
					// info(
					// 	`[WS] no signed txs from source account ${config.SOURCE_ADDRESS}`
					// );
					return;

				this.emit("sourceAccountTxs", sourceSignedTxs);
			} catch (err: any) {
				error("[WS] error parsing message:", err.message);
			}
		});

		this.ws.on("error", (err: Error) => {
			error("[WS] error:", err.message);
		});

		this.ws.on("close", (code: number, reason: Buffer) => {
			warn(
				`[WS] closed: ${code} - ${reason.toString()}. reconnecting in 5s ...`
			);

			if (this.pingInterval) clearInterval(this.pingInterval);
			setTimeout(() => this.connect(), 5_000);
		});
	}

	disconnect() {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}
}
