import { PumpfunSdk } from "../pumpfun/sdk";
import {
	getOrCreateKeypairSigner,
	getTokenBalance,
	LAMPORTS_PER_SOL,
	printSolBalance,
	printTokenBalance as printTokenBalance,
} from "../utils";
import { RpcConnection } from "../types";

import { KeyPairSigner } from "@solana/kit";
import { openAsBlob } from "fs";
import { PriorityFee } from "../types";
import { error, info } from "../logger";

// 1 buy & 1 sell
const MAX_ITERATIONS = 1;
const DEFAULT_DECIMALS = 6;
// 5% slippage
const SLIPPAGE_BASIS_POINTS = 500n;
const PRIORITY_FEE = {
	unitLimit: 250000,
	unitPrice: 250000,
};

const BUY_AMOUNT_SOL = BigInt(0.01 * LAMPORTS_PER_SOL);

const intervalMs = 5000;

async function createAndBuyTestToken(
	sdk: PumpfunSdk,
	creatorSigner: KeyPairSigner,
	mintSigner: KeyPairSigner,
	buyAmountLamports: bigint = 1000n,
	slippageBp: bigint = 500n,
	priorityFees?: PriorityFee
) {
	let boundingCurveAccount = await sdk.getBondingCurveAccount(
		mintSigner.address
	);

	if (!boundingCurveAccount) {
		info(
			`[PUMPSIM] No bonding curve account found for mint ${mintSigner.address}, creating a new one...`
		);

		let tokenMetadata = {
			name: "TST-99",
			symbol: "TST-99",
			description: "TST-99: This is a test token",
			file: await openAsBlob("./assets/random.png"),
		};

		let { success, error } = await sdk.createAndBuy(
			creatorSigner,
			mintSigner,
			tokenMetadata,
			buyAmountLamports,
			slippageBp,
			priorityFees
		);

		if (!success) {
			console.error("Error creating and buying:", error);
			return;
		}

		info(
			`[PUMPSIM] success: \nhttps://pump.fun/${mintSigner.address} \nhttps://solscan.io/account/${creatorSigner.address}?cluster=devnet#portfolio`
		);

		return;
	}
}

export async function simulateAlternatingBuysAndSells(
	rpc: RpcConnection,
	sourceSigner: KeyPairSigner,
	mintSigner: KeyPairSigner,
	maxIterations: number = MAX_ITERATIONS,
	sellNum: bigint = 1n,
	sellDen: bigint = 1n,
	buyAmountLamports: bigint = BUY_AMOUNT_SOL
) {
	info(`[PUMPSIM] simulating with address ${sourceSigner.address}`);

	const pumpfunSdk = new PumpfunSdk(sourceSigner);

	await createAndBuyTestToken(pumpfunSdk, sourceSigner, mintSigner).catch((e) =>
		console.error("failed to create and buy test token:", e.message)
	);

	let toggle = true;

	let count = 0;

	while (count < maxIterations * 2) {
		try {
			if (toggle) {
				info(`[PUMPSIM] BUY iteration ${count + 1}`);
				try {
					const txResult = await pumpfunSdk.buy(
						mintSigner.address,
						sourceSigner,
						buyAmountLamports,
						SLIPPAGE_BASIS_POINTS,
						PRIORITY_FEE
					);
				} catch (e: any) {
					error("[PUMPSIM] failed to submit BUY tx:", e.message);
				}
			} else {
				info(`[PUMPSIM] SELL iteration ${count + 1}`);

				try {
					let currentTokenBalance = await getTokenBalance(
						rpc,
						mintSigner.address,
						sourceSigner.address
					);

					if (!currentTokenBalance || currentTokenBalance === 0n) {
						info(
							`[PUMPSIM] account ${sourceSigner.address} owns no units for mint ${mintSigner.address}`
						);
						return;
					}

					await pumpfunSdk
						.sell(
							mintSigner.address,
							sourceSigner,
							(currentTokenBalance * sellNum) / sellDen,
							SLIPPAGE_BASIS_POINTS,
							PRIORITY_FEE
						)
						.catch((e) =>
							error("[PUMPSIM] failed to submit SELL tx:", e.message)
						);
				} catch (e: any) {
					error(
						"[PUMPSIM] failed to get token balance or submit SELL tx:",
						e.message
					);
				}
			}
		} catch (e) {
			error("[PUMPSIM] tx error:", e);
		}

		toggle = !toggle;
		count++;
		await new Promise((r) => setTimeout(r, intervalMs));
	}

	info("[PUMPSIM] simulation completed");
	return;
}
