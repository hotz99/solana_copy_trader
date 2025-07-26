import {
	getBytesDecoder,
	getU64Decoder,
	getStructDecoder,
	fixDecoderSize,
	ReadonlyUint8Array,
	getBooleanDecoder,
	getBase64Decoder,
} from "@solana/codecs";
import { Address, address, getAddressDecoder } from "@solana/addresses";

import bs58 from "bs58";
import { JsonParsedIx, RpcConnection, TxMessage, TxResponse } from "../types";
import { info, warn } from "../logger";
import {
	getTokenBalance,
	resolveSolBasedTradeFactor,
	resolveTokenBasedTradeFactor,
} from "../utils";
import { Position } from "../storage";
import config from "../config";
import { PumpfunSdk } from "./sdk";
import { AccountRole, KeyPairSigner } from "@solana/kit";

const PUMPFUN_PROGRAM_ID = address(
	"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
export const BUY_IX_DISCRIMINATOR = new Uint8Array([
	102, 6, 61, 18, 1, 218, 235, 234,
]);
export const SELL_IX_DISCRIMINATOR = new Uint8Array([
	51, 230, 133, 164, 1, 127, 131, 173,
]);
const EXPECTED_ACCOUNT_COUNT = 12;

export interface DecodedPumpfunBuyIx {
	name: "buy";
	discriminator: ReadonlyUint8Array;
	accounts: {
		global: Address;
		feeRecipient: Address;
		mint: Address;
		bondingCurve: Address;
		associatedBondingCurve: Address;
		associatedUser: Address;
		user: Address;
		systemProgram: Address;
		tokenProgram: Address;
		rent: Address;
		eventAuthority: Address;
		program: Address;
	};
	args: {
		amount: bigint;
		maxSolCost: bigint;
	};
}

export interface DecodedPumpfunSellIx {
	name: "sell";
	discriminator: ReadonlyUint8Array;
	accounts: {
		global: Address;
		feeRecipient: Address;
		mint: Address;
		bondingCurve: Address;
		associatedBondingCurve: Address;
		associatedUser: Address;
		user: Address;
		systemProgram: Address;
		associatedTokenProgram: Address;
		tokenProgram: Address;
		eventAuthority: Address;
		program: Address;
	};
	args: {
		amount: bigint;
		minSolOutput: bigint;
	};
}

const buyIxDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["amount", getU64Decoder()],
	["maxSolCost", getU64Decoder()],
]);

const sellIxDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["amount", getU64Decoder()],
	["minSolOutput", getU64Decoder()],
]);

export interface PumpfunTradeIx {
	programAddress: Address;
	accounts: { address: Address; role: AccountRole }[];
	data: Uint8Array;
}

export async function resolvePumpfunIxs(
	rpc: RpcConnection,
	sdk: PumpfunSdk,
	ourSigner: KeyPairSigner,
	txWithMeta: TxResponse,
	activeMap: Map<string, Position>
): Promise<{ ourBuyIxs: PumpfunTradeIx[]; ourSellIxs: PumpfunTradeIx[] }> {
	const txMessage = txWithMeta.transaction.message as TxMessage;
	const pumpfunIxs = (
		txMessage.instructions as unknown as JsonParsedIx[]
	).filter((ix) => ix.programId === PUMPFUN_PROGRAM_ID);

	if (pumpfunIxs.length === 0)
		info("[PUMP] no pumpfun instructions found in transaction");

	const ourBuyIxs: PumpfunTradeIx[] = [];
	const ourSellIxs: PumpfunTradeIx[] = [];

	for (const ix of pumpfunIxs) {
		const rawIxData = bs58.decode(ix.data);
		if (rawIxData.length < 8) continue;

		const disc = rawIxData.subarray(0, 8);

		if (disc.every((b, i) => b === BUY_IX_DISCRIMINATOR[i])) {
			if (rawIxData.length < 24) throw new Error("buy ix too short");

			const decodedBuy = decodePumpfunBuyIx(rawIxData, ix.accounts);

			if (
				!config.ENABLE_MULTI_BUY &&
				Array.from(activeMap.values()).some(
					(p) => p.mintAddress === decodedBuy.accounts.mint
				)
			) {
				info(`[PUMP] skipping multi-buy for ${decodedBuy.accounts.mint}`);
				return;
			}

			const mintAddress = decodedBuy.accounts.mint;

			// TODO move this outside the `ixs` iterator to avoid repeated rpc calls ?
			const bondingCurve = await sdk.getBondingCurveAccount(mintAddress);
			if (!bondingCurve)
				throw new Error(`no bonding curve account for ${mintAddress}`);

			// TODO fix `TxResponse` to match `jsonParsed` structure so `any` cast is not needed
			const accountKeys = txWithMeta.transaction.message.accountKeys as any[];
			const userAccountIdx = accountKeys.findIndex(
				(acc) => acc.pubkey === decodedBuy.accounts.user
			);

			const balances = {
				preTokenBalances: txWithMeta.meta?.preTokenBalances,
				postTokenBalances: txWithMeta.meta?.postTokenBalances,
				preBalances: txWithMeta.meta?.preBalances,
				postBalances: txWithMeta.meta?.postBalances,
			};

			let tradeFactor = resolveTokenBasedTradeFactor(
				mintAddress,
				decodedBuy.accounts.user,
				userAccountIdx,
				balances
			);

			let ourTokenOutputAmount: bigint;

			if (tradeFactor) {
				const ourTokenBalance = await getTokenBalance(
					rpc,
					mintAddress,
					ourSigner.address
				);
				ourTokenOutputAmount = BigInt(
					Math.floor(Number(ourTokenBalance) * tradeFactor)
				);
			} else {
				info(`[PUMP] using SOL-based trade factor buy for ${mintAddress}`);
				tradeFactor = resolveSolBasedTradeFactor(
					mintAddress,
					decodedBuy.accounts.user,
					userAccountIdx,
					txWithMeta
				);
				const { value: ourSolBalance } = await rpc
					.getBalance(ourSigner.address, {
						commitment: "confirmed",
					})
					.send();

				if (!ourSolBalance) throw new Error("failed to fetch our SOL balance");

				const ourBuyAmount = ourSolBalance * BigInt(tradeFactor);
				ourTokenOutputAmount =
					bondingCurve.getTokenOutputForLamports(ourBuyAmount);
			}

			info(`[PUMP] source increased position by ${tradeFactor * 100}%`);

			ourBuyIxs.push(
				await sdk.getBuyIx(ourSigner, mintAddress, ourTokenOutputAmount)
			);
			continue;
		}

		if (disc.every((b, i) => b === SELL_IX_DISCRIMINATOR[i])) {
			if (rawIxData.length < 24) throw new Error("sell ix too short");

			const decodedSell = decodePumpfunSellIx(rawIxData, ix.accounts);

			// TODO fix `TxResponse` to match `jsonParsed` structure so `any` cast is not needed
			const accountKeys = txWithMeta.transaction.message.accountKeys as any[];
			const userAccountIdx = accountKeys.findIndex(
				(acc) => acc.pubkey === decodedSell.accounts.user
			);

			// const { useSol, tradeFactor } = computeProportionalTradeFactor(
			// 	decodedSell.accounts.mint,
			// 	decodedSell.accounts.user,
			// 	userAccountIdx,
			// 	txWithMeta.meta
			// );

			// info(`[PUMP] source decreased position by ${tradeFactor * 100}%`);
		}
	}

	return {
		ourBuyIxs,
		ourSellIxs,
	};
}

function decodePumpfunBuyIx(
	rawIxData: ReadonlyUint8Array,
	ixAccounts: readonly Address[]
): DecodedPumpfunBuyIx {
	if (ixAccounts.length !== EXPECTED_ACCOUNT_COUNT) {
		throw new Error(
			`Expected ${EXPECTED_ACCOUNT_COUNT} accounts, found ${ixAccounts.length}`
		);
	}

	const accounts = {
		global: ixAccounts[0],
		feeRecipient: ixAccounts[1],
		mint: ixAccounts[2],
		bondingCurve: ixAccounts[3],
		associatedBondingCurve: ixAccounts[4],
		associatedUser: ixAccounts[5],
		user: ixAccounts[6],
		systemProgram: ixAccounts[7],
		tokenProgram: ixAccounts[8],
		rent: ixAccounts[9],
		eventAuthority: ixAccounts[10],
		program: ixAccounts[11],
	};

	const { discriminator, amount, maxSolCost } = buyIxDecoder.decode(rawIxData);

	return {
		name: "buy",
		discriminator,
		accounts,
		args: {
			amount,
			maxSolCost,
		},
	};
}

function decodePumpfunSellIx(
	rawIxData: ReadonlyUint8Array,
	ixAccounts: readonly Address[]
): DecodedPumpfunSellIx {
	if (ixAccounts.length !== EXPECTED_ACCOUNT_COUNT) {
		throw new Error(
			`Expected ${EXPECTED_ACCOUNT_COUNT} accounts, found ${ixAccounts.length}`
		);
	}

	const accounts = {
		global: ixAccounts[0],
		feeRecipient: ixAccounts[1],
		mint: ixAccounts[2],
		bondingCurve: ixAccounts[3],
		associatedBondingCurve: ixAccounts[4],
		associatedUser: ixAccounts[5],
		user: ixAccounts[6],
		systemProgram: ixAccounts[7],
		associatedTokenProgram: ixAccounts[8],
		tokenProgram: ixAccounts[9],
		eventAuthority: ixAccounts[10],
		program: ixAccounts[11],
	};

	const { discriminator, amount, minSolOutput } =
		sellIxDecoder.decode(rawIxData);

	return {
		name: "sell",
		discriminator,
		accounts,
		args: {
			amount,
			minSolOutput,
		},
	};
}

const TRADE_EVENT_DISCRIMINATOR = Uint8Array.from([
	189, 219, 127, 211, 78, 230, 97, 238,
]);

const TradeEventDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["mint", getAddressDecoder()],
	["solAmount", getU64Decoder()],
	["tokenAmount", getU64Decoder()],
	["isBuy", getBooleanDecoder()],
	["user", getAddressDecoder()],
	["timestamp", getU64Decoder()],
	["virtualSolReserves", getU64Decoder()],
	["virtualTokenReserves", getU64Decoder()],
	["realSolReserves", getU64Decoder()],
	["realTokenReserves", getU64Decoder()],
	["feeRecipient", getAddressDecoder()],
	["feeBasisPoints", getU64Decoder()],
	["fee", getU64Decoder()],
	["creator", getAddressDecoder()],
	["creatorFeeBasisPoints", getU64Decoder()],
	["creatorFee", getU64Decoder()],
]);

export interface TradeEvent {
	mint: Address;
	solAmount: bigint;
	tokenAmount: bigint;
	isBuy: boolean;
	user: Address;
	timestamp: bigint;
	virtualSolReserves: bigint;
	virtualTokenReserves: bigint;
	realSolReserves: bigint;
	realTokenReserves: bigint;
	feeRecipient: Address;
	feeBasisPoints: bigint;
	fee: bigint;
	creator: Address;
	creatorFeeBasisPoints: bigint;
	creatorFee: bigint;
}

export function parsePumpFunTradeEvents(
	logMessages: readonly string[]
): TradeEvent[] {
	const events: TradeEvent[] = [];

	for (const line of logMessages) {
		const prefix = "Program data: ";
		if (!line.startsWith(prefix)) continue;

		const payload = line.slice(prefix.length).trim();

		info("[PUMP] log message payload:", payload);

		let b64Data: Uint8Array;
		try {
			// anchor events are base64‐encoded
			b64Data = Buffer.from(payload, "base64");
		} catch {
			warn("[PUMP] failed to decode base64 payload");
			continue;
		}

		if (
			b64Data.length > 8 &&
			TRADE_EVENT_DISCRIMINATOR.every(
				(b, i) => b64Data[i] === TRADE_EVENT_DISCRIMINATOR[i]
			)
		) {
			// if no data after discriminator bytes
			if (b64Data.length === 0) {
				warn("[PUMP] payload too short for TradeEvent");
				continue;
			}

			const decoded = TradeEventDecoder.decode(b64Data);
			events.push({
				mint: decoded.mint,
				solAmount: decoded.solAmount,
				tokenAmount: decoded.tokenAmount,
				isBuy: decoded.isBuy,
				user: decoded.user,
				timestamp: decoded.timestamp,
				virtualSolReserves: decoded.virtualSolReserves,
				virtualTokenReserves: decoded.virtualTokenReserves,
				realSolReserves: decoded.realSolReserves,
				realTokenReserves: decoded.realTokenReserves,
				feeRecipient: decoded.feeRecipient,
				feeBasisPoints: decoded.feeBasisPoints,
				fee: decoded.fee,
				creator: decoded.creator,
				creatorFeeBasisPoints: decoded.creatorFeeBasisPoints,
				creatorFee: decoded.creatorFee,
			});
		}
	}

	return events;
}
