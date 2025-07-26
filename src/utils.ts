// TODO use the base58 codec from @solana/kit instead of bs58
import bs58 from "bs58";
import {
	findAssociatedTokenPda,
	TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

import config from "./config";

import { readFile, writeFile, mkdir } from "fs/promises";
// TODO is there an async version of existsSync ?
import { existsSync, openAsBlob } from "fs";
import {
	Address,
	createKeyPairFromBytes,
	createKeyPairSignerFromBytes,
	createKeyPairSignerFromPrivateKeyBytes,
	KeyPairSigner as CryptoKeyPair,
	generateKeyPairSigner,
	getAddressEncoder,
	getBase58Decoder,
	getBase58Encoder,
	getBytesDecoder,
	getStructDecoder,
	getU32Decoder,
	getU64Decoder,
	KeyPairSigner,
	Lamports,
	TokenBalance,
} from "@solana/kit";
import path from "path";
import { PumpfunSdk } from "./pumpfun/sdk";
import { JsonParsedIx, RpcConnection, SolUsdPrice, TxResponse } from "./types";
import { error, info } from "./logger";
import { parsePumpFunTradeEvents } from "./pumpfun/decoder";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const BASIS_POINTS_DIVISOR = 10_000n;

export async function getOrCreateKeypairSigner(
	keypairFilepath: string
): Promise<KeyPairSigner> {
	const keypairDirectory = path.dirname(keypairFilepath);

	if (!existsSync(keypairDirectory)) {
		await mkdir(keypairDirectory, { recursive: true });
	}

	if (existsSync(keypairFilepath)) {
		const content = await readFile(keypairFilepath, "utf-8");
		const json: {
			privateKey: string;
			publicKey: string;
		} = JSON.parse(content);

		const privateKeyBytes = bs58.decode(json.privateKey);
		return await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes);
	}

	const keypair = await crypto.subtle.generateKey(
		{ name: "Ed25519", namedCurve: "Ed25519" },
		true,
		["sign", "verify"]
	);

	const pkcs8 = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", keypair.privateKey)
	);
	const privateKeySeed = pkcs8.slice(-32); // last 32 bytes = Ed25519 seed

	const publicKeyBytes = new Uint8Array(
		await crypto.subtle.exportKey("raw", keypair.publicKey)
	);

	await writeFile(
		keypairFilepath,
		JSON.stringify(
			{
				privateKey: bs58.encode(privateKeySeed),
				publicKey: bs58.encode(publicKeyBytes),
			},
			null,
			2
		),
		"utf-8"
	);

	return await createKeyPairSignerFromPrivateKeyBytes(privateKeySeed);
}

export function getIsoTimestamp(): string {
	return new Date().toISOString();
}

export function rawToDecimalString(raw: bigint, decimals: number): string {
	const s = raw.toString();
	if (decimals === 0) return s;
	if (s.length <= decimals) {
		return "0." + "0".repeat(decimals - s.length) + s;
	}
	const intPart = s.slice(0, s.length - decimals);
	const fracPart = s.slice(s.length - decimals);
	return `${intPart}.${fracPart}`;
}

const transferDecoder = getStructDecoder([
	["instruction", getU32Decoder()],
	["lamports", getU64Decoder()],
]);

const b58Encoder = getBase58Encoder();

// in this context, system program transfers are pumpfun/jupiter CPIs
// which are defined as inner ixs in the tx, hence no need to check the outer ixs
// TODO fix typing
export function resolveSolTransfersFromInnerIxs(
	sourceAddress: Address,
	jsonParsedTxWithMeta: any
): { destAccount: string; lamports: bigint }[] {
	const transfers: { destAccount: string; lamports: bigint }[] = [];
	const accountKeys = jsonParsedTxWithMeta.transaction.message.accountKeys;
	for (const inner of jsonParsedTxWithMeta.meta?.innerInstructions ?? []) {
		for (const ix of inner.instructions) {
			info("[UTILS] inner ix:", ix);

			// `jsonParsed` encoding ensures `program` and `parsed` are valid fields
			if (ix.program !== "system" || ix.parsed.type !== "transfer") continue;

			transfers.push({
				destAccount: ix.parsed.info.destination,
				lamports: ix.parsed.info.lamports,
			});
		}
	}

	return transfers;
}

export function resolveTokenBasedTradeFactor(
	tokenMint: Address,
	ownerAddress: Address,
	ownerAccountIdx: number,
	balances: {
		preTokenBalances: readonly TokenBalance[];
		postTokenBalances: readonly TokenBalance[];
		preBalances: readonly Lamports[];
		postBalances: readonly Lamports[];
	}
): number | null {
	const tokenPre = balances.preTokenBalances.find(
		(b) => b.mint === tokenMint && b.owner === ownerAddress
	);
	const tokenPost = balances.postTokenBalances.find(
		(b) => b.mint === tokenMint && b.owner === ownerAddress
	);

	if (tokenPre && tokenPost && tokenPre?.uiTokenAmount.amount !== "0") {
		const preAmount = BigInt(tokenPre.uiTokenAmount.amount);

		const postAmount = BigInt(tokenPost.uiTokenAmount.amount);

		const tokenDelta = postAmount - preAmount;
		const absChange = tokenDelta < 0n ? -tokenDelta : tokenDelta;

		const proportion = Number(absChange) / Number(preAmount);
		return proportion;
	}

	return null;
}

export function resolveSolBasedTradeFactor(
	tokenMint: Address,
	ownerAddress: Address,
	ownerAccountIdx: number,
	txWithMeta: TxResponse,
	isBuy: boolean = true
): number | null {
	const tradeEvents = parsePumpFunTradeEvents(txWithMeta.meta.logMessages);
	if (tradeEvents.length === 0) {
		info("[PUMP] no trade events found in transaction");
		return null;
	}

	const tradeAmount = tradeEvents
		.filter((e) => (isBuy ? e.isBuy : !e.isBuy) && e.user === ownerAddress)
		.reduce(
			(acc, event) => acc + (event.mint === tokenMint ? event.solAmount : 0n),
			0n
		);

	info(`[PUMP] trade amount for mint ${tokenMint}:`, tradeAmount);

	return (
		Number(tradeAmount) / Number(txWithMeta.meta.preBalances[ownerAccountIdx])
	);

	// OLD approach
	// const solTransfers = resolveSolTransfersFromInnerIxs(
	// 	ownerAddress,
	// 	txWithMeta
	// );

	// const tokenBuyCost =
	// 	solTransfers.find(
	// 		(t) =>
	// 			t.destAccount === creatorVaultAddress ||
	// 			t.destAccount === bondingCurveAddress
	// 	)?.lamports ?? 0n;

	// const preLamports = BigInt(txWithMeta.meta.preBalances[ownerAccountIdx]);

	// if (preLamports === 0n || tokenBuyCost <= 0n) return 0;

	// const proportion = Number(tokenBuyCost) / Number(preLamports);
	// return proportion;
}

// TODO fallback to CoinGecko if Coinvera fails
export async function getTokenUsdPrice(
	mintAddress: Address
): Promise<SolUsdPrice | null> {
	const url = `https://api.coinvera.io/api/v1/price?ca=${mintAddress}`;
	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": config.COINVERA_API_KEY,
			},
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

		const { priceInSol, priceInUsd } = await res.json();
		return {
			solPriceFloatString: priceInSol,
			usdPriceFloatString: priceInUsd,
		};
	} catch (err) {
		error(
			`[priceChecker] Failed to fetch price for ${mintAddress}: ${err.message}`
		);
		return null;
	}
}

export const printSolBalance = async (
	rpc: RpcConnection,
	accountAddress: Address,
	header: string = ""
) => {
	const balance = await rpc.getBalance(accountAddress).send();
	console.log(
		`${header ? header + " " : ""}${accountAddress}:`,
		balance.value / BigInt(LAMPORTS_PER_SOL),
		`SOL`
	);
};

export const getTokenBalance = async (
	rpc: RpcConnection,
	mintAddress: Address,
	userAccountAddress: Address,
	allowOffCurve: boolean = false
) => {
	let [userAta] = await findAssociatedTokenPda({
		mint: mintAddress,
		owner: userAccountAddress,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const { value } = await rpc
		.getTokenAccountBalance(userAta, {
			// TODO not sure about this commitment value
			commitment: "processed",
		})
		.send();

	if (!value)
		// if account does not exist
		return null;

	return BigInt(value.amount);
};

export const printTokenBalance = async (
	rpc: RpcConnection,
	mintAddress: Address,
	userAccountAddress: Address,
	header: string = ""
) => {
	const balance = await getTokenBalance(rpc, mintAddress, userAccountAddress);
	if (balance === null) {
		console.log(
			`${header ? header + " " : ""}${userAccountAddress}:`,
			`SPL token account not found`
		);
	} else {
		console.log(`${header ? header + " " : ""}${userAccountAddress}:`, balance);
	}
};

export const baseToValue = (base: number, decimals: number): number => {
	return base * Math.pow(10, decimals);
};

export const valueToBase = (value: number, decimals: number): number => {
	return value / Math.pow(10, decimals);
};

export function getBase64EncodedTransactionRequest(
	txSignature: string,
	commitment: string = "confirmed",
	maxTxVersion: number = 0
): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "getTransaction",
		params: [
			txSignature,
			{
				encoding: "base64",
				commitment: commitment,
				maxSupportedTransactionVersion: maxTxVersion,
			},
		],
	});
}

export function getBlockSubscriptionRequest(
	accountAddress: Address,
	commitment: string = "confirmed",
	encoding: string = "jsonParsed",
	transactionDetails: string = "full",
	maxTxVersion: number = 0,
	showRewards: boolean = false
): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "blockSubscribe",
		params: [
			{ mentionsAccountOrProgram: accountAddress },
			{
				commitment,
				encoding,
				transactionDetails,
				maxSupportedTransactionVersion: maxTxVersion,
				showRewards,
			},
		],
	});
}

export const lamportsToSolString = (
	lamports: bigint,
	includeUnit = true
): string => {
	const solAmount = lamports / BigInt(LAMPORTS_PER_SOL);
	return `${solAmount.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})} ${includeUnit ? "SOL" : ""}`;
};

// TODO may be useful
// export function updateAtaSubscriptions(
// 	ws: WebSocket,
// 	rpcConnection: Connection,
// 	mainAccount: string,
// 	ataList: string[],
// 	subscriptionId: number
// ): void {
// 	const updatedAtas = getAtaList(rpcConnection, mainAccount);

// 	ataList.forEach((ata) => {
// 		const request = {
// 			jsonrpc: "2.0",
// 			id: subscriptionId++,
// 			method: "accountSubscribe",
// 			params: [ata, { encoding: "jsonParsed", commitment: "confirmed" }],
// 		};
// 		ws.send(JSON.stringify(request));
// 		console.log("subscribed to ATA:", ata);
// 	});
// }
