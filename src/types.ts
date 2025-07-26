import { Address, createSolanaRpc } from "@solana/kit";

export type RpcConnection = ReturnType<typeof createSolanaRpc>;

export type TxResponse = NonNullable<
	Awaited<ReturnType<ReturnType<RpcConnection["getTransaction"]>["send"]>>
>;

export type TxMessage = NonNullable<TxResponse["transaction"]>["message"];

export type JsonIx = NonNullable<TxMessage["instructions"]>[number];

export type JsonParsedAccountKey = {
	pubkey: string;
	signer: boolean;
	writable: boolean;
};

export type JsonParsedIx = {
	programId: Address;
	accounts: Address[];
	data: string;
	stackHeight: number;
};

export type SolUsdPrice = {
	solPriceFloatString: string;
	usdPriceFloatString: string;
};

export type ResponseEncoding = "json" | "jsonParsed" | "base58" | "base64";

export type CreateTokenMetadata = {
	name: string;
	symbol: string;
	description: string;
	file: Blob;
	twitter?: string;
	telegram?: string;
	website?: string;
};

export type TokenMetadata = {
	name: string;
	symbol: string;
	description: string;
	image: string;
	showName: boolean;
	createdOn: string;
	twitter: string;
};

export type CreateEvent = {
	name: string;
	symbol: string;
	uri: string;
	mintAddress: Address;
	bondingCurveAddress: Address;
	userAddress: Address;
};

export type TradeEvent = {
	mintAddress: Address;
	solAmount: bigint;
	tokenAmount: bigint;
	isBuy: boolean;
	userAddress: Address;
	unixTimestamp: number;
	virtualSolReserves: bigint;
	virtualTokenReserves: bigint;
	realSolReserves: bigint;
	realTokenReserves: bigint;
};

export type CompleteEvent = {
	userAddress: Address;
	mintAddress: Address;
	bondingCurve: Address;
	unixTimestamp: number;
};

export type SetParamsEvent = {
	feeRecipient: Address;
	initialVirtualTokenReserves: bigint;
	initialVirtualSolReserves: bigint;
	initialRealTokenReserves: bigint;
	tokenTotalSupply: bigint;
	feeBasisPoints: bigint;
};

export interface PumpFunEventHandlers {
	createEvent: CreateEvent;
	tradeEvent: TradeEvent;
	completeEvent: CompleteEvent;
	setParamsEvent: SetParamsEvent;
}

export type PumpFunEventType = keyof PumpFunEventHandlers;

export type PriorityFee = {
	unitLimit: number;
	unitPrice: number;
};

export type TransactionResult = {
	signature?: string;
	success: boolean;
	error?: unknown;
};
