import {
	Address,
	address,
	Base58EncodedBytes,
	createSolanaRpc,
	getAddressDecoder,
	getBase58Decoder,
	getStructDecoder,
	getU64Decoder,
	signature,
} from "@solana/kit";

import bs58 from "bs58";
import { RpcConnection, TxResponse } from "../types";
import { error, info } from "console";

export interface JupiterSwapEvent {
	amm: Address;
	inputMint: Address;
	inputAmount: bigint;
	outputMint: Address;
	outputAmount: bigint;
}

const JUPITER_V6_PROGRAM_ID = address(
	"JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

const SWAP_EVENT_DISCRIMINATOR = new Uint8Array([
	64, 198, 205, 232, 38, 8, 113, 226,
]);

const SwapEventDecoder = getStructDecoder([
	["amm", getAddressDecoder()],
	["inputMint", getAddressDecoder()],
	["inputAmount", getU64Decoder()],
	["outputMint", getAddressDecoder()],
	["outputAmount", getU64Decoder()],
]);

export async function resolveJupiterSwapEvents(
	txJson: TxResponse
): Promise<JupiterSwapEvent[]> {
	info("Tx landed at slot", txJson.slot);

	const swapIxIdx = txJson.transaction.message.instructions.findIndex((ix) => {
		const program = txJson.transaction.message.accountKeys[ix.programIdIndex];
		return program === JUPITER_V6_PROGRAM_ID;
	});
	if (swapIxIdx === -1) {
		throw new Error("Unable to find Jupiter Swap instruction");
	}

	const innerIxs = txJson.meta?.innerInstructions?.find(
		(innerIx) => innerIx.index === swapIxIdx
	)?.instructions;
	if (!innerIxs) {
		throw new Error("Unable to find Jupiter Swap inner instructions");
	}

	const allInnerIxs =
		txJson.meta?.innerInstructions?.flatMap(
			({ instructions }) => instructions
		) ?? [];

	info(`found ${allInnerIxs.length} total inner instructions`);

	return await decodeJupiterSwapEvents(allInnerIxs.map((ix) => ix.data));
}

async function decodeJupiterSwapEvents(
	b58Ixs: Base58EncodedBytes[]
): Promise<JupiterSwapEvent[]> {
	const results: JupiterSwapEvent[] = [];

	for (const ix of b58Ixs) {
		const ixBytes = bs58.decode(ix);
		if (ixBytes.length < 16) continue;

		const eventBytes = ixBytes.subarray(8);
		if (eventBytes.length < 8) continue;

		const discBytes = eventBytes.subarray(0, 8);
		if (!discBytes.every((byte, idx) => byte === SWAP_EVENT_DISCRIMINATOR[idx]))
			continue;

		results.push(SwapEventDecoder.decode(eventBytes.subarray(8)));
	}

	return results;
}

async function main() {
	const rpc: RpcConnection = createSolanaRpc(
		"https://api.mainnet-beta.solana.com"
	);
	const txSignature = signature(
		"3CP9Dd9YEFByYysugSKvSN17fVYL7FGakz4VLrKhg9XiamJt4mVAdZtAZB7EWKQzP7Jda26gs41BvY9EQKorT4k6"
	);

	try {
		const txJson = await rpc
			.getTransaction(txSignature, {
				commitment: "confirmed",
				encoding: "json",
				maxSupportedTransactionVersion: 0,
			})
			.send();

		const swapEvents = await resolveJupiterSwapEvents(txJson);
		info("Decoded Jupiter Swap Events:", swapEvents);
	} catch (error) {
		error("Error resolving Jupiter Swap Events:", error);
	}
}

main().catch((err) => {
	error("Error in main function:", err);
});
