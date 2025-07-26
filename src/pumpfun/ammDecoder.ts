import {
	getBytesDecoder,
	getU64Decoder,
	getStructDecoder,
	fixDecoderSize,
	ReadonlyUint8Array,
} from "@solana/codecs";
import { createSolanaRpc } from "@solana/rpc";
import { Signature } from "@solana/keys";
import { Address, address } from "@solana/addresses";

import bs58 from "bs58";
import { JsonIx, TxMessage } from "../types";

type RpcConnection = ReturnType<typeof createSolanaRpc>;

const PUMPFUN_AMM_PROGRAM_ID = address(
	"pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);

const BUY_IX_DISCRIMINATOR = new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_IX_DISCRIMINATOR = new Uint8Array([
	51, 230, 133, 164, 1, 127, 131, 173,
]);

const BUY_EXPECTED_ACCOUNTS = 19;
const SELL_EXPECTED_ACCOUNTS = 19;

interface PumpFunBuyInstruction {
	name: "buy";
	discriminator: ReadonlyUint8Array;
	accounts: {
		pool: Address;
		user: Address;
		globalConfig: Address;
		baseMint: Address;
		quoteMint: Address;
		userBaseTokenAccount: Address;
		userQuoteTokenAccount: Address;
		poolBaseTokenAccount: Address;
		poolQuoteTokenAccount: Address;
		protocolFeeRecipient: Address;
		protocolFeeRecipientTokenAccount: Address;
		baseTokenProgram: Address;
		quoteTokenProgram: Address;
		systemProgram: Address;
		associatedTokenProgram: Address;
		eventAuthority: Address;
		program: Address;
		coinCreatorVaultAta: Address;
		coinCreatorVaultAuthority: Address;
	};
	args: {
		baseAmountOut: bigint;
		maxQuoteAmountIn: bigint;
	};
}

interface PumpFunSellInstruction {
	name: "sell";
	discriminator: ReadonlyUint8Array;
	accounts: {
		pool: Address;
		user: Address;
		globalConfig: Address;
		baseMint: Address;
		quoteMint: Address;
		userBaseTokenAccount: Address;
		userQuoteTokenAccount: Address;
		poolBaseTokenAccount: Address;
		poolQuoteTokenAccount: Address;
		protocolFeeRecipient: Address;
		protocolFeeRecipientTokenAccount: Address;
		baseTokenProgram: Address;
		quoteTokenProgram: Address;
		systemProgram: Address;
		associatedTokenProgram: Address;
		eventAuthority: Address;
		program: Address;
		coinCreatorVaultAta: Address;
		coinCreatorVaultAuthority: Address;
	};
	args: {
		baseAmountIn: bigint;
		minQuoteAmountOut: bigint;
	};
}

const ammBuyIxDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["baseAmountOut", getU64Decoder()],
	["maxQuoteAmountIn", getU64Decoder()],
]);

const ammSellIxDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["baseAmountIn", getU64Decoder()],
	["minQuoteAmountOut", getU64Decoder()],
]);

export function resolvePumpfunAmmIxs(txMessage: TxMessage): {
	buyIxs: PumpFunBuyInstruction[];
	sellIxs: PumpFunSellInstruction[];
} {
	const pumpfunAmmIxs = txMessage.instructions.filter(
		(ix) =>
			txMessage.accountKeys[ix.programIdIndex] === PUMPFUN_AMM_PROGRAM_ID &&
			ix.data.length > 0
	);

	if (pumpfunAmmIxs.length === 0)
		throw new Error("No PumpFun AMM instructions found");

	const buyIxs: PumpFunBuyInstruction[] = [];
	const sellIxs: PumpFunSellInstruction[] = [];

	let decodedIx: any;

	for (const ix of pumpfunAmmIxs) {
		const raw = bs58.decode(ix.data);
		if (raw.length < 8) continue;

		const disc = raw.subarray(0, 8);

		if (disc.every((b, i) => b === BUY_IX_DISCRIMINATOR[i])) {
			if (raw.length < 24) throw new Error("buy ix too short");
			buyIxs.push(
				composePumpfunAmmBuyIx(
					ammBuyIxDecoder.decode(raw),
					ix.accounts,
					txMessage.accountKeys
				)
			);
			continue;
		}

		if (disc.every((b, i) => b === SELL_IX_DISCRIMINATOR[i])) {
			if (raw.length < 24) throw new Error("sell ix too short");
			sellIxs.push(
				composePumpfunAmmSellIx(
					ammSellIxDecoder.decode(raw),
					ix.accounts,
					txMessage.accountKeys
				)
			);
		}
	}

	return {
		buyIxs,
		sellIxs,
	};
}

function composePumpfunAmmBuyIx(
	decodedIx: {
		discriminator: ReadonlyUint8Array;
		maxQuoteAmountIn: bigint;
		baseAmountOut: bigint;
	},
	ixAccounts: readonly number[],
	txAccountsKeys: readonly Address[]
): PumpFunBuyInstruction {
	if (ixAccounts.length !== BUY_EXPECTED_ACCOUNTS) {
		throw new Error(
			`Expected ${BUY_EXPECTED_ACCOUNTS} accounts, found ${ixAccounts.length}`
		);
	}

	const accounts = {
		pool: txAccountsKeys[ixAccounts[0]],
		user: txAccountsKeys[ixAccounts[1]],
		globalConfig: txAccountsKeys[ixAccounts[2]],
		baseMint: txAccountsKeys[ixAccounts[3]],
		quoteMint: txAccountsKeys[ixAccounts[4]],
		userBaseTokenAccount: txAccountsKeys[ixAccounts[5]],
		userQuoteTokenAccount: txAccountsKeys[ixAccounts[6]],
		poolBaseTokenAccount: txAccountsKeys[ixAccounts[7]],
		poolQuoteTokenAccount: txAccountsKeys[ixAccounts[8]],
		protocolFeeRecipient: txAccountsKeys[ixAccounts[9]],
		protocolFeeRecipientTokenAccount: txAccountsKeys[ixAccounts[10]],
		baseTokenProgram: txAccountsKeys[ixAccounts[11]],
		quoteTokenProgram: txAccountsKeys[ixAccounts[12]],
		systemProgram: txAccountsKeys[ixAccounts[13]],
		associatedTokenProgram: txAccountsKeys[ixAccounts[14]],
		eventAuthority: txAccountsKeys[ixAccounts[15]],
		program: txAccountsKeys[ixAccounts[16]],
		coinCreatorVaultAta: txAccountsKeys[ixAccounts[17]],
		coinCreatorVaultAuthority: txAccountsKeys[ixAccounts[18]],
	};

	return {
		name: "buy",
		discriminator: decodedIx.discriminator,
		accounts,
		args: {
			baseAmountOut: decodedIx.baseAmountOut,
			maxQuoteAmountIn: decodedIx.maxQuoteAmountIn,
		},
	};
}

function composePumpfunAmmSellIx(
	decodedIx: {
		discriminator: ReadonlyUint8Array;
		baseAmountIn: bigint;
		minQuoteAmountOut: bigint;
	},
	ixAccounts: readonly number[],
	txAccountKeys: readonly Address[]
): PumpFunSellInstruction {
	if (ixAccounts.length !== SELL_EXPECTED_ACCOUNTS) {
		throw new Error(
			`Expected ${SELL_EXPECTED_ACCOUNTS} accounts, found ${ixAccounts.length}`
		);
	}

	const accounts = {
		pool: txAccountKeys[ixAccounts[0]],
		user: txAccountKeys[ixAccounts[1]],
		globalConfig: txAccountKeys[ixAccounts[2]],
		baseMint: txAccountKeys[ixAccounts[3]],
		quoteMint: txAccountKeys[ixAccounts[4]],
		userBaseTokenAccount: txAccountKeys[ixAccounts[5]],
		userQuoteTokenAccount: txAccountKeys[ixAccounts[6]],
		poolBaseTokenAccount: txAccountKeys[ixAccounts[7]],
		poolQuoteTokenAccount: txAccountKeys[ixAccounts[8]],
		protocolFeeRecipient: txAccountKeys[ixAccounts[9]],
		protocolFeeRecipientTokenAccount: txAccountKeys[ixAccounts[10]],
		baseTokenProgram: txAccountKeys[ixAccounts[11]],
		quoteTokenProgram: txAccountKeys[ixAccounts[12]],
		systemProgram: txAccountKeys[ixAccounts[13]],
		associatedTokenProgram: txAccountKeys[ixAccounts[14]],
		eventAuthority: txAccountKeys[ixAccounts[15]],
		program: txAccountKeys[ixAccounts[16]],
		coinCreatorVaultAta: txAccountKeys[ixAccounts[17]],
		coinCreatorVaultAuthority: txAccountKeys[ixAccounts[18]],
	};

	return {
		name: "sell",
		discriminator: decodedIx.discriminator,
		accounts,
		args: {
			baseAmountIn: decodedIx.baseAmountIn,
			minQuoteAmountOut: decodedIx.minQuoteAmountOut,
		},
	};
}
