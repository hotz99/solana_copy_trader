// import config from "./config";
// import { info, warn, error } from "./logger";
// import CopyEmitter from "./websocket";
// import storage, { Position } from "./storage";
// import { mapDex } from "./dexMapper";
// import { getPriceOnChain, sleep } from "./priceChecker";
// import { buyToken, sellToken } from "./tradeExecutor";
import { error, info, warn } from "./logger";
import {
	getActivePositions,
	initStorage,
	Position,
	updatePosition,
} from "./storage";
import {
	getOrCreateKeypairSigner,
	getTokenBalance,
	getTokenUsdPrice as getTokenPrice,
	LAMPORTS_PER_SOL,
	rawToDecimalString,
} from "./utils";
import config from "./config";
import CopyEmitter from "./copyEmitter";
import { resolvePumpfunIxs } from "./pumpfun/decoder";

import { createSolanaRpc, address, Signature, Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TxMessage } from "./types";
import { simulateAlternatingBuysAndSells } from "./simulators/pumpfunAccountSimulator";
import { PumpfunSdk } from "./pumpfun/sdk";

const rpc = createSolanaRpc(config.DEVNET_RPC_URL);

// poll until `txSignature` is confirmed or timeout
async function waitForConfirmation(
	txSignature: Signature,
	timeoutSecs = 15
): Promise<boolean> {
	const start = Date.now();
	while ((Date.now() - start) / 1000 < timeoutSecs) {
		try {
			const { value } = await rpc.getSignatureStatuses([txSignature]).send();

			const status = value?.[0]?.confirmationStatus;
			if (status === "confirmed" || status === "finalized") return true;
		} catch {
			// ignore transient errors
		}
		await new Promise((resolve) => setTimeout(resolve, timeoutSecs * 1000));
	}
	warn(`[CONFIRM] timed out waiting for ${txSignature}`);
	return false;
}

// ----------------------------------------------------------------------------
// — SAFE SELL with on-chain re-check for our token balance
// ----------------------------------------------------------------------------
const ourAddress = address(config.PUBLIC_KEY);

async function safeSell(pos: Position): Promise<boolean> {
	const { mintAddress, tokenAmount: storedAmt, id, dex } = pos;

	try {
		// await sellToken({
		// 	mintAddress,
		// 	amountTokens: storedAmt,
		// 	slippage: config.SLIPPAGE_BP,
		// 	tip: config.JITO_TIP,
		// 	dex,
		// });
		console.log("[MAIN] sellToken not implemented yet");
		return true;
	} catch (err: any) {
		const msg = err.message ?? "";
		if (msg.includes("Insufficient SPL token balance")) {
			warn(
				`[MAIN] insufficient balance for sell ${id}: ${msg}. re-fetching on-chain balance ...`
			);

			const { value: ourTargetTokenAtas } = await rpc
				.getTokenAccountsByOwner(
					ourAddress,
					{ mint: mintAddress, programId: TOKEN_PROGRAM_ADDRESS },
					{ encoding: "jsonParsed" }
				)
				.send();

			let totalTokenUnits = 0n;
			let decimals: number | null = null;
			// TODO can we make this cleaner ?
			for (const ata of ourTargetTokenAtas) {
				const info = ata.account.data.parsed.info.tokenAmount;
				totalTokenUnits += BigInt(info.amount);
				decimals = info.decimals;
			}

			const balanceStr =
				decimals !== null ? rawToDecimalString(totalTokenUnits, decimals) : "0";
			const balanceNum = parseFloat(balanceStr);

			if (balanceNum > 0) {
				info(`[MAIN] retrying sell of ${balanceStr} for ${id} ...`);
				try {
					// await sellToken({
					// 	mint,
					// 	amountTokens: balanceStr,
					// 	slippage: config.SLIPPAGE_BP,
					// 	tip: config.JITO_TIP,
					// 	dex,
					// });
					console.log("[MAIN] sellToken not implemented yet");
					return true;
				} catch (err2: any) {
					error(`[MAIN] liquidation retry failed for ${id}: ${err2.message}`);
					return false;
				}
			} else {
				info(`[MAIN] liquidation finished. updating ${id} as closed.`);
				updatePosition(id, { status: "closed" });
				return false;
			}
		}
		throw err;
	}
}

async function main() {
	info("=== Starting Copy-Trading Bot ===");

	initStorage();
	const activeMap = new Map<string, Position>();
	for (const pos of getActivePositions()) {
		activeMap.set(pos.id, { ...pos });
	}

	const ourSigner = await getOrCreateKeypairSigner(
		"./keypairs/our_keypair.json"
	);
	const sdk = new PumpfunSdk(ourSigner, config.DEVNET_RPC_URL);

	// SELL-ALL mode
	if (config.BOT_MODE === "SELLING") {
		info("[MAIN] SELLING all active positions ...");
		for (const pos of activeMap.values()) {
			const sold = await safeSell(pos);
			if (sold) {
				updatePosition(pos.id, { status: "closed", currentPrice: 0 });
				info(`[MAIN] closed ${pos.id}`);
			}
		}
		process.exit(0);
	}

	// PRICE POLLING loop for SAFE mode
	async function pricePollingLoop() {
		for (const pos of activeMap.values()) {
			if (pos.status !== "active") continue;

			try {
				const entry = parseFloat(pos.entryPrice.toString());
				const priceData = await getTokenPrice(pos.mintAddress);
				if (!priceData) continue;
				const current = parseFloat(priceData.usdPriceFloatString);
				pos.currentPrice = current;
				updatePosition(pos.id, { currentPrice: current });

				if (pos.tradeType === "SAFE") {
					const changePercentage = ((current - entry) / entry) * 100;
					if (changePercentage >= (pos.takeProfitPercentage ?? 0)) {
						info(`[TP] ${pos.id} +${changePercentage.toFixed(2)}% → selling`);
						await safeSell(pos);
						updatePosition(pos.id, { status: "closed" });
						activeMap.delete(pos.id);
					} else if (changePercentage <= -(pos.stopLossPercentage ?? 0)) {
						info(`[SL] ${pos.id} ${changePercentage.toFixed(2)}% → selling`);
						await safeSell(pos);
						updatePosition(pos.id, { status: "closed" });
						activeMap.delete(pos.id);
					}
				}
			} catch (e: any) {
				error(`[MAIN] pricePollingLoop ${pos.id}: ${e.message}`);
			}
		}
	}
	info(`[MAIN] polling prices every ${config.PRICE_CHECK_DELAY_MS}ms`);
	setInterval(pricePollingLoop, config.PRICE_CHECK_DELAY_MS);

	// WEBSOCKET copy-wallet listener
	const emitter = new CopyEmitter();
	emitter.connect();
	// TODO properly type this
	emitter.on("sourceAccountTxs", async (txsWithMeta: any[]) => {
		try {
			txsWithMeta.forEach(async (txWithMeta) => {
				const { ourBuyIxs, ourSellIxs } = await resolvePumpfunIxs(
					txWithMeta,
					activeMap,
					sdk
				);
				// info(
				// 	`[MAIN] resolved ${ourBuyIxs.length} buy and ${ourSellIxs.length} sell ixs`
				// );
			});
			// const {
			// 	signature: sig,
			// 	dexs,
			// 	ca: mintAddress,
			// 	trade,
			// 	solAmount,
			// 	tokenAmount,
			// } = msg;
			// let dex = mapDex(dexs) ?? "jupiter";

			// COPY BUY
			if (trade === "buy" && solAmount < 0) {
				if (
					!config.ENABLE_MULTI_BUY &&
					Array.from(activeMap.values()).some((p) => p.mint === mintAddress)
				) {
					info(`[MAIN] skipping multi-buy for ${mintAddress}`);
					return;
				}

				const buyAmt =
					config.TRADE_TYPE === "EXACT"
						? Math.abs(solAmount)
						: config.BUY_AMOUNT;

				info(`[MAIN] Copy buy ${mintAddress} for ${buyAmt} SOL on ${dex}`);
				const txSig = await buyToken({
					mint: mintAddress,
					amountSol: buyAmt,
					slippage: config.SLIPPAGE_BP,
					tip: config.JITO_TIP,
					dex,
				});

				info(`[MAIN] Waiting confirmation ${txSig}`);
				if (!(await waitForConfirmation(txSig))) return;

				// fetch on-chain balance & price
				const ownerAddr = address(config.PUBLIC_KEY);
				const parsed = await rpc
					.getTokenAccountsByOwner(
						ownerAddr,
						{ mint: mintAddress, programId: TOKEN_PROGRAM_ADDRESS },
						{ encoding: "jsonParsed" }
					)
					.send();

				let totalRaw = 0n,
					dec: number | null = null;
				for (const acct of parsed.value) {
					totalRaw += BigInt(acct.account.data.parsed.info.tokenAmount.amount);
					dec = acct.account.data.parsed.info.tokenAmount.decimals;
				}
				const tokenAmtStr =
					dec != null ? rawToDecimalString(totalRaw, dec) : "0";

				const prices = await getTokenPrice(mintAddress);
				const entryPrice = prices ? parseFloat(prices.usdPriceFloatString) : 0;

				const newPos = addPosition({
					mint: mintAddress,
					buy_amount: buyAmt,
					token_amount: tokenAmtStr,
					entry_price: entryPrice,
					current_price: entryPrice,
					status: "active",
					trade_mode: config.TRADE_TYPE,
					parent_signature: sig,
					stop_loss_pct: config.TRADE_TYPE === "SAFE" ? config.STOP_LOSS : null,
					take_profit_pct:
						config.TRADE_TYPE === "SAFE" ? config.TAKE_PROFIT : null,
					dex,
				});
				activeMap.set(newPos.id, newPos);
				info(`[MAIN] New position ${newPos.id} ${mintAddress}@${entryPrice}`);
			}

			// // COPY SELL (EXACT mode)
			// else if (
			// 	trade === "sell" &&
			// 	tokenAmount < 0 &&
			// 	config.TRADE_TYPE === "EXACT"
			// ) {
			// 	const pos = Array.from(activeMap.values()).find(
			// 		(p) => p.mintAddress === mintAddress && p.tradeType === "EXACT"
			// 	);
			// 	if (!pos) return;
			// 	info(`[MAIN] Copy sell ${mintAddress} → closing ${pos.id}`);
			// 	await safeSell(pos);
			// 	updatePosition(pos.id, { status: "closed" });
			// 	activeMap.delete(pos.id);
			// }
		} catch (e: any) {
			error(`[MAIN] failed to handle source account tx: ${e.message}`);
		}
	});

	const sourceSigner = await getOrCreateKeypairSigner(
		"./keypairs/test_keypair.json"
	);
	const mintSigner = await getOrCreateKeypairSigner(
		"./keypairs/test_mint_keypair.json"
	);

	const currentTokenBalance = await getTokenBalance(
		rpc,
		mintSigner.address,
		sourceSigner.address
	);

	// double token holdings each iteration or buy 0.01 SOL if no tokens
	// TODO this should be 0.001 SOL be actually is 0.000000001 SOL
	const buyAmountLamports = BigInt(0.01 * LAMPORTS_PER_SOL);

	await simulateAlternatingBuysAndSells(
		rpc,
		sourceSigner,
		mintSigner,
		// perform 1 buy and 1 sell
		1,
		// sell 1/2 of token balance each iteration
		1n,
		1n,
		buyAmountLamports
	);
}

main().catch((err) => {
	error(`[MAIN] ${err.message}`);
	process.exit(1);
});
