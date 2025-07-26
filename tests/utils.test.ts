import {
	address,
	createSolanaRpc,
	getBase58Encoder,
	KeyPairSigner,
	lamports,
	Signature,
	signature,
	stringifiedBigInt,
	stringifiedNumber,
} from "@solana/kit";
import { RpcConnection, TxResponse } from "../src/types";

import {
	resolveTokenBasedTradeFactor,
	rawToDecimalString,
	baseToValue,
	valueToBase,
	getBase64EncodedTransactionRequest,
	getBlockSubscriptionRequest,
	lamportsToSolString,
	getTokenUsdPrice,
	getOrCreateKeypairSigner,
	LAMPORTS_PER_SOL,
	getTokenBalance,
	resolveSolTransfersFromInnerIxs,
	resolveSolBasedTradeFactor,
} from "../src/utils";
import config from "../src/config";
import { info } from "../src/logger";
import { simulateAlternatingBuysAndSells } from "../src/simulators/pumpfunAccountSimulator";
import { PumpfunSdk } from "../src/pumpfun/sdk";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { parsePumpFunTradeEvents } from "../src/pumpfun/decoder";

// allow greater timeout for tests with rpc calls
const TIMEOUT_MS = 60_000;

describe("rawToDecimalString", () => {
	it("handles zero decimals", () => {
		expect(rawToDecimalString(123n, 0)).toBe("123");
	});

	it("pads when raw length <= decimals", () => {
		expect(rawToDecimalString(5n, 3)).toBe("0.005");
	});

	it("inserts decimal point correctly", () => {
		expect(rawToDecimalString(12345n, 2)).toBe("123.45");
	});
});

describe("parsePumpFunTradeEvents", () => {
	jest.setTimeout(30_000);

	it("fetches a pumpfun buy tx from devnet and parses its tradeEvent", async () => {
		const txSig = signature(
			"5E3GJmpR7yWFgH8wWCSLj34sfxkaarcH3o4D7Et1YTyiiJ8enuboAEgRGJSHwSrJpPsPYetWbsNXbwbJu4hKwDTc"
		);

		const rpc = createSolanaRpc(config.DEVNET_RPC_URL);

		const txWithMeta = await rpc
			.getTransaction(txSig, {
				encoding: "jsonParsed",
				commitment: "confirmed",
				maxSupportedTransactionVersion: 0,
			})
			.send();

		const events = parsePumpFunTradeEvents(txWithMeta.meta.logMessages);

		expect(events.length).toBeGreaterThan(0);

		const ev = events[0];

		expect(typeof ev.mint).toBe("string");
		expect(ev.solAmount).toBeGreaterThan(0n);
		expect(ev.tokenAmount).toBeGreaterThan(0n);
		expect(typeof ev.isBuy).toBe("boolean");
		expect(ev.isBuy).toBe(true);
		expect(typeof ev.user).toBe("string");
		expect(ev.timestamp).toBeGreaterThan(0n);
	});
});

// TODO centralize program addresses
describe("computeTradeFactors", () => {
	let sourceSigner: KeyPairSigner;
	let mintSigner: KeyPairSigner;
	let rpc: RpcConnection;

	const firstBuyPumpfunTxSig = signature(
		"5E3GJmpR7yWFgH8wWCSLj34sfxkaarcH3o4D7Et1YTyiiJ8enuboAEgRGJSHwSrJpPsPYetWbsNXbwbJu4hKwDTc"
	);
	let firstBuyPumpfunTxWithMeta: any;

	let lastBuySig: Signature;
	let lastSellSig: Signature;

	// run this once before any tests in this block
	beforeAll(async () => {
		jest.setTimeout(TIMEOUT_MS);
		sourceSigner = await getOrCreateKeypairSigner(
			"./keypairs/test_keypair.json"
		);
		mintSigner = await getOrCreateKeypairSigner(
			"./keypairs/test_mint_keypair.json"
		);
		rpc = createSolanaRpc(config.DEVNET_RPC_URL);

		const currentTokenBalance = await getTokenBalance(
			rpc,
			mintSigner.address,
			sourceSigner.address
		);

		// double token holdings each iteration or buy 0.01 SOL if no tokens
		// const buyAmountSol =
		// 	currentTokenBalance > 0n
		// 		? currentTokenBalance * 2n
		// 		: BigInt(0.01 * LAMPORTS_PER_SOL);

		const buyAmountSol =
			(await rpc.getBalance(sourceSigner.address).send()).value / 100n;

		info("[JEST] buy amount in SOL:", buyAmountSol);

		await simulateAlternatingBuysAndSells(
			rpc,
			sourceSigner,
			mintSigner,
			// perform 1 buy and 1 sell
			1,
			// sell 1/2 of token balance each iteration
			1n,
			1n,
			buyAmountSol
		);

		info("[JEST] simulated buys and sells for test");

		firstBuyPumpfunTxWithMeta = await rpc
			.getTransaction(firstBuyPumpfunTxSig, {
				encoding: "jsonParsed",
				commitment: "confirmed",
				maxSupportedTransactionVersion: 0,
			})
			.send();

		const sigs = await rpc
			.getSignaturesForAddress(sourceSigner.address, { limit: 2 })
			.send();

		// simulator buys then sells & `getSignaturesForAddress` in most recent order
		[lastSellSig, lastBuySig] = [sigs[0].signature, sigs[1].signature];

		info("[JEST] last buy signature:", lastBuySig);
		info("[JEST] last sell signature:", lastSellSig);
	});

	it("calculates trade proportion based on token delta", () => {
		const program = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
		const ownerAccountIdx = 0;
		const balances = {
			preTokenBalances: [
				{
					accountIndex: ownerAccountIdx,
					mint: mintSigner.address,
					owner: sourceSigner.address,
					programId: program,
					uiTokenAmount: {
						amount: stringifiedBigInt("100"),
						decimals: 2,
						uiAmount: 1,
						uiAmountString: stringifiedNumber("1.00"),
					},
				},
				{
					accountIndex: ownerAccountIdx,
					// alternative mint address, does not have to be correct/real
					mint: sourceSigner.address,
					owner: sourceSigner.address,
					programId: program,
					uiTokenAmount: {
						amount: stringifiedBigInt("100"),
						decimals: 2,
						uiAmount: 1,
						uiAmountString: stringifiedNumber("1.00"),
					},
				},
			],
			postTokenBalances: [
				{
					accountIndex: ownerAccountIdx,
					mint: mintSigner.address,
					owner: sourceSigner.address,
					programId: program,
					uiTokenAmount: {
						amount: stringifiedBigInt("90"),
						decimals: 2,
						uiAmount: 0.9,
						uiAmountString: stringifiedNumber("0.90"),
					},
				},
				{
					accountIndex: ownerAccountIdx,
					// alternative mint address, does not have to be correct/real
					mint: sourceSigner.address,
					owner: sourceSigner.address,
					programId: program,
					uiTokenAmount: {
						amount: stringifiedBigInt("240"),
						decimals: 2,
						uiAmount: 2.4,
						uiAmountString: stringifiedNumber("2.40"),
					},
				},
			],
			preBalances: [lamports(0n)],
			postBalances: [lamports(0n)],
		};

		const ptf1 = resolveTokenBasedTradeFactor(
			mintSigner.address,
			sourceSigner.address,
			ownerAccountIdx,
			balances
		);
		expect(ptf1).toBeCloseTo(0.1);

		const ptf2 = resolveTokenBasedTradeFactor(
			sourceSigner.address,
			sourceSigner.address,
			ownerAccountIdx,
			balances
		);
		expect(ptf2).toBeCloseTo(1.4);
	});

	it.only("falls back to SOL-based proportion on trades with pre-tx balance of zero or null", () => {
		const ownerAccountIdx = 1;
		const programId = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
		const balances = {
			preTokenBalances: [
				{
					accountIndex: ownerAccountIdx,
					mint: mintSigner.address,
					owner: sourceSigner.address,
					programId,
					uiTokenAmount: {
						amount: stringifiedBigInt("0"),
						decimals: 2,
						uiAmount: 0,
						uiAmountString: stringifiedNumber("0.00"),
					},
				},
			],
			postTokenBalances: [
				{
					accountIndex: ownerAccountIdx,
					mint: mintSigner.address,
					owner: sourceSigner.address,
					programId,
					uiTokenAmount: {
						amount: stringifiedBigInt("90"),
						decimals: 2,
						uiAmount: 0.9,
						uiAmountString: stringifiedNumber("0.90"),
					},
				},
			],
			preBalances: [lamports(1000n), lamports(2000n)],
			postBalances: [lamports(1000n), lamports(1800n)],
		};

		const ttf = resolveTokenBasedTradeFactor(
			mintSigner.address,
			sourceSigner.address,
			ownerAccountIdx,
			balances
		);

		expect(ttf).toBeNull();

		info("[JEST] no token-based trade factor, falling back to SOL-based");
		const stf = resolveSolBasedTradeFactor(
			mintSigner.address,
			sourceSigner.address,
			ownerAccountIdx,
			// this `txWithMeta` is unrelated to the balances above
			// just for testing purposes
			firstBuyPumpfunTxWithMeta
		);

		expect(stf).toBeGreaterThan(0);
		expect(stf).toBeLessThanOrEqual(1);
		info("[JEST] SOL-based trade factor:", stf);
	});
});

describe("parseSolTransfersFromInnerInstructions", () => {
	let sourceSigner: KeyPairSigner;
	let mintSigner: KeyPairSigner;
	let rpc: RpcConnection;
	const pumpfunBuySig = signature(
		"5E3GJmpR7yWFgH8wWCSLj34sfxkaarcH3o4D7Et1YTyiiJ8enuboAEgRGJSHwSrJpPsPYetWbsNXbwbJu4hKwDTc"
	);
	let pumpfunBuy;

	beforeAll(async () => {
		jest.setTimeout(TIMEOUT_MS);
		sourceSigner = await getOrCreateKeypairSigner(
			"./keypairs/test_keypair.json"
		);
		mintSigner = await getOrCreateKeypairSigner(
			"./keypairs/test_mint_keypair.json"
		);
		rpc = createSolanaRpc(config.DEVNET_RPC_URL);

		pumpfunBuy = await rpc
			.getTransaction(signature(pumpfunBuySig), {
				encoding: "jsonParsed",
				commitment: "confirmed",
				maxSupportedTransactionVersion: 0,
			})
			.send();
	});

	it("parses SOL transfers from inner instructions", () => {
		info("[JEST] pumpfun buy tx:", pumpfunBuy);

		const sourceAddr = sourceSigner.address;
		const destAddr = address(SYSTEM_PROGRAM_ADDRESS);
		const transfers = resolveSolTransfersFromInnerIxs(sourceAddr, pumpfunBuy);

		info("[JEST] SOL transfers:", transfers);
	});
});

describe("baseToValue & valueToBase", () => {
	it("converts base to value", () => {
		expect(baseToValue(1.23, 2)).toBe(123);
	});
	it("converts value to base", () => {
		expect(valueToBase(123, 2)).toBe(1.23);
	});
});

describe("JSON-RPC request builders", () => {
	it("builds getTransaction request", () => {
		const req = JSON.parse(
			getBase64EncodedTransactionRequest("txsig", "finalized", 2)
		);
		expect(req.method).toBe("getTransaction");
		expect(req.params[0]).toBe("txsig");
		expect(req.params[1]).toMatchObject({
			encoding: "base64",
			commitment: "finalized",
			maxSupportedTransactionVersion: 2,
		});
	});

	const sourceAddress = address(config.SOURCE_ADDRESS);

	it("builds blockSubscribe request", () => {
		const req = JSON.parse(
			getBlockSubscriptionRequest(
				sourceAddress,
				"processed",
				"json",
				"signatures",
				1,
				true
			)
		);
		expect(req.method).toBe("blockSubscribe");
		expect(req.params[0]).toEqual({ mentionsAccountOrProgram: sourceAddress });
		expect(req.params[1]).toMatchObject({
			commitment: "processed",
			encoding: "json",
			transactionDetails: "signatures",
			maxSupportedTransactionVersion: 1,
			showRewards: true,
		});
	});
});

describe("lamportsToSolString", () => {
	it("formats lamports to SOL with 2 decimals and unit", () => {
		expect(lamportsToSolString(1_500_000_000n)).toBe("1.50 SOL");
	});
	it("omits unit when requested", () => {
		expect(lamportsToSolString(2_000_000_000n, false)).toBe("2.00 ");
	});
});

describe("getTokenUsdPrice", () => {
	beforeEach(() => {
		(global as any).fetch = jest.fn();
	});

	const wsolMintAddress = address(
		"So11111111111111111111111111111111111111112"
	);

	it("returns price object on success", async () => {
		const price = await getTokenUsdPrice(wsolMintAddress);
		expect(price).not.toBeNull();
		expect(parseFloat(price!.solPriceFloatString)).toBeGreaterThan(0);
		expect(parseFloat(price!.usdPriceFloatString)).toBeGreaterThan(0);
	});

	// TODO wtf is this ?
	it("returns null on HTTP error", async () => {
		(global as any).fetch.mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "ServerError",
		});
		const price = await getTokenUsdPrice(wsolMintAddress);
		expect(price).toBeNull();
	});
});
