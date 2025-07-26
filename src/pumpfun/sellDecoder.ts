import {
	getBytesDecoder,
	getU64Decoder,
	getStructDecoder,
	fixDecoderSize,
	ReadonlyUint8Array,
} from "@solana/codecs";
import { createSolanaRpc, Rpc } from "@solana/rpc";
import { Signature } from "@solana/keys";
import { Address, address } from "@solana/addresses";

import bs58 from "bs58";
import { TxMessage } from "../types";

type RpcConnection = ReturnType<typeof createSolanaRpc>;

const PUMPFUN_PROGRAM_ID = address(
	"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const SELL_IX_DISCRIMINATOR = new Uint8Array([
	51, 230, 133, 164, 1, 127, 131, 173,
]);
const EXPECTED_ACCOUNT_COUNT = 12;

const sellIxDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["amount", getU64Decoder()],
	["minSolOutput", getU64Decoder()],
]);

interface PumpFunSellInstruction {
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

export async function resolvePumpfunSellInstructions(
	rpc: RpcConnection,
	txSignature: string
): Promise<PumpFunSellInstruction[]> {
	const txResponse = await rpc
		.getTransaction(txSignature as Signature, {
			commitment: "confirmed",
			encoding: "json",
			maxSupportedTransactionVersion: 0,
		})
		.send();

	if (!txResponse?.transaction) {
		throw new Error("Transaction not found");
	}

	const txMessage = txResponse.transaction.message;

	return decodeSellInstructionsFromJsonTxMessage(txMessage);
}

function decodeSellInstructionsFromJsonTxMessage(
	txMessage: TxMessage
): PumpFunSellInstruction[] {
	const pumpfunIxs = txMessage.instructions.filter(
		(ix) => txMessage.accountKeys[ix.programIdIndex] === PUMPFUN_PROGRAM_ID
	);

	if (pumpfunIxs.length === 0)
		throw new Error("No Pump.fun sell instructions found in transaction");

	return pumpfunIxs.map((ix) => {
		if (ix.accounts.length !== EXPECTED_ACCOUNT_COUNT) {
			throw new Error(
				`Expected ${EXPECTED_ACCOUNT_COUNT} accounts, found ${ix.accounts.length}`
			);
		}

		const accounts = {
			global: txMessage.accountKeys[ix.accounts[0]],
			feeRecipient: txMessage.accountKeys[ix.accounts[1]],
			mint: txMessage.accountKeys[ix.accounts[2]],
			bondingCurve: txMessage.accountKeys[ix.accounts[3]],
			associatedBondingCurve: txMessage.accountKeys[ix.accounts[4]],
			associatedUser: txMessage.accountKeys[ix.accounts[5]],
			user: txMessage.accountKeys[ix.accounts[6]],
			systemProgram: txMessage.accountKeys[ix.accounts[7]],
			associatedTokenProgram: txMessage.accountKeys[ix.accounts[8]],
			tokenProgram: txMessage.accountKeys[ix.accounts[9]],
			eventAuthority: txMessage.accountKeys[ix.accounts[10]],
			program: txMessage.accountKeys[ix.accounts[11]],
		};

		const decodedIx = sellIxDecoder.decode(bs58.decode(ix.data));

		if (
			!decodedIx.discriminator.every(
				(byte, idx) => byte === SELL_IX_DISCRIMINATOR[idx]
			)
		) {
			throw new Error(
				"Instruction discriminator doesn't match sell instruction"
			);
		}

		return {
			name: "sell",
			discriminator: decodedIx.discriminator,
			accounts,
			args: {
				amount: decodedIx.amount,
				minSolOutput: decodedIx.minSolOutput,
			},
		};
	});
}
