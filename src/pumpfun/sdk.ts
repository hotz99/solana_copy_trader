import {
	createSolanaRpc,
	signature,
	address,
	getBase58Encoder,
	getBytesDecoder,
	getU64Encoder,
	getStructDecoder,
	fixDecoderSize,
	Signature,
	Address,
	getProgramDerivedAddress,
	getBytesEncoder,
	getAddressEncoder,
	ProgramDerivedAddress,
	KeyPairSigner,
	createTransactionMessage,
	pipe,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	appendTransactionMessageInstructions,
	signTransactionMessageWithSigners,
	AccountRole,
	getAddressDecoder,
	getU64Decoder,
	addCodecSizePrefix,
	getUtf8Codec,
	getU32Codec,
	getBooleanDecoder,
	sendAndConfirmTransactionFactory,
	getSignatureFromTransaction,
	getBase64Decoder,
	createSolanaRpcSubscriptions,
	sendTransactionWithoutConfirmingFactory,
	isSolanaError,
	SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
	partiallySignTransactionMessageWithSigners,
	signTransaction,
	compileTransaction,
	Commitment,
	getAddressCodec,
	TransactionMessage,
	CompilableTransactionMessage,
	TransactionMessageWithBlockhashLifetime,
	getU32Encoder,
	getComputeUnitEstimateForTransactionMessageFactory,
	prependTransactionMessageInstructions,
	getBase64Encoder,
} from "@solana/kit";

import bs58 from "bs58";
import {
	BASIS_POINTS_DIVISOR,
	// calculateWithSlippageBuy,
	// calculateWithSlippageSell,
	// DEFAULT_COMMITMENT,
	// DEFAULT_FINALITY,
	// sendTx,
	// simulateTx,
	// PriorityFee,
	// TransactionResult,
	// SimulatedTransactionResult,
	getOrCreateKeypairSigner,
	getTokenBalance,
	LAMPORTS_PER_SOL,
	printSolBalance,
	printTokenBalance as printTokenBalance,
} from "../utils";
import fs, { glob, openAsBlob } from "fs";
import {
	BUY_IX_DISCRIMINATOR,
	PumpfunTradeIx,
	SELL_IX_DISCRIMINATOR,
} from "./decoder";
import {
	fetchToken,
	findAssociatedTokenPda,
	getCreateAssociatedTokenInstructionAsync,
} from "@solana-program/token";
import {
	CreateTokenMetadata,
	PriorityFee,
	RpcConnection,
	TransactionResult,
} from "../types";
import {
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { BondingCurveAccount } from "./bondingCurveAccount";
import { GlobalAccount } from "./globalAccount";
import { error, info } from "../logger";
import config from "../config";

const DEFAULT_COMMITMENT = "confirmed";

const PUMPFUN_PROGRAM_ADDRESS = address(
	"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const MPL_TOKEN_METADATA_PROGRAM_ADDRESS = address(
	"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
const TOKEN_PROGRAM_ADDRESS = address(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const SYSVAR_RENT_ADDRESS = address(
	"SysvarRent111111111111111111111111111111111"
);

export const GLOBAL_ACCOUNT_SEED = "global";
export const MINT_AUTHORITY_SEED = "mint-authority";
export const BONDING_CURVE_SEED = "bonding-curve";
export const METADATA_SEED = "metadata";
export const EVENT_AUTHORITY_SEED = "__event_authority";
export const CREATOR_VAULT_SEED = "creator-vault";

const CREATE_IX_DISCRIMINATOR = new Uint8Array([
	24, 30, 200, 40, 5, 28, 7, 119,
]);

const createStringCodec = () =>
	addCodecSizePrefix(getUtf8Codec(), getU32Codec());

const createIxDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["name", createStringCodec()],
	["symbol", createStringCodec()],
	["uri", createStringCodec()],
	["creator", getAddressDecoder()],
]);

export class PumpfunSdk {
	private rpc = createSolanaRpc(config.DEVNET_RPC_URL);
	private rpcSubscriptions = createSolanaRpcSubscriptions(
		config.DEVNET_WSS_URL
	);
	private signer?: KeyPairSigner;

	private programAddress = PUMPFUN_PROGRAM_ADDRESS;

	private stringCodec = createStringCodec();
	private base64Encoder = getBase64Encoder();
	private u64Encoder = getU64Encoder();
	private addressCodec = getAddressCodec();

	constructor(signer: KeyPairSigner, rpcUrl?: string, wssUrl?: string) {
		this.rpc = createSolanaRpc(rpcUrl ?? config.DEVNET_RPC_URL);
		this.rpcSubscriptions = createSolanaRpcSubscriptions(
			wssUrl ?? config.DEVNET_WSS_URL
		);
		this.signer = signer;
	}

	private sendAndConfirm = sendAndConfirmTransactionFactory({
		rpc: this.rpc,
		rpcSubscriptions: this.rpcSubscriptions,
	});
	private computeUnitEstimator =
		getComputeUnitEstimateForTransactionMessageFactory({ rpc: this.rpc });

	async createAndBuy(
		creatorSigner: KeyPairSigner = this.signer,
		mintSigner: KeyPairSigner,
		createTokenMetadata: CreateTokenMetadata,
		buyAmountLamports: bigint,
		slippageBp: bigint = 500n,
		priorityFees?: PriorityFee,
		commitment: Commitment = DEFAULT_COMMITMENT
	): Promise<TransactionResult> {
		let tokenMetadata = await this.createTokenMetadata(createTokenMetadata);

		let createTokenIx = await this.getCreateTokenIx(
			creatorSigner,
			mintSigner.address,
			createTokenMetadata.name,
			createTokenMetadata.symbol,
			tokenMetadata.metadataUri
		);

		const { value: blockhash } = await this.rpc.getLatestBlockhash().send();

		const txMessage = await pipe(
			createTransactionMessage({ version: 0 }),
			(tx) => setTransactionMessageFeePayerSigner(creatorSigner, tx),
			(tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
			(tx) => appendTransactionMessageInstructions([createTokenIx], tx),
			async (tx) =>
				buyAmountLamports > 0
					? appendTransactionMessageInstructions(
							[
								// create user ATA since buy ix assumes it exists
								await getCreateAssociatedTokenInstructionAsync({
									payer: creatorSigner,
									mint: mintSigner.address,
									owner: creatorSigner.address,
								}),
								await this.getBuyIx(
									creatorSigner,
									mintSigner.address,
									buyAmountLamports,
									slippageBp,
									creatorSigner.address
								),
							],
							tx
					  )
					: tx
		);

		const signedTx = await signTransaction(
			[creatorSigner.keyPair, mintSigner.keyPair],
			compileTransaction(txMessage)
		);

		try {
			await this.sendAndConfirm(signedTx, {
				commitment,
			});

			info(
				`[SDK] createTokenTx ${commitment}:`,
				getSignatureFromTransaction(signedTx)
			);
			return {
				success: true,
				signature: signature.toString(),
			};
		} catch (e) {
			if (
				isSolanaError(
					e,
					SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
				)
			) {
				console.error(e);
			} else {
				throw e;
			}
			return {
				success: false,
				error: e.message,
			};
		}
	}

	async getCreateTokenIx(
		creatorSigner: KeyPairSigner,
		mintAddress: Address,
		name: string,
		symbol: string,
		uri: string
	) {
		const [metadataPda] = await getProgramDerivedAddress({
			programAddress: MPL_TOKEN_METADATA_PROGRAM_ADDRESS,
			seeds: [
				METADATA_SEED,
				this.addressCodec.encode(MPL_TOKEN_METADATA_PROGRAM_ADDRESS),
				this.addressCodec.encode(mintAddress),
			],
		});

		const [mintAuthorityPda] = await getProgramDerivedAddress({
			programAddress: this.programAddress,
			seeds: [MINT_AUTHORITY_SEED],
		});

		const [bondingCurvePda] = await this.getBondingCurveAccountPda(mintAddress);

		const [bcurveAta] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: bondingCurvePda,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});

		const [globalAccountPda] = await this.getGlobalAccountPda();

		const [eventAuthorityPda] = await this.getEventAuthorityAccountPda();

		const ixData = new Uint8Array([
			...CREATE_IX_DISCRIMINATOR,
			...this.stringCodec.encode(name),
			...this.stringCodec.encode(symbol),
			...this.stringCodec.encode(uri),
			...this.addressCodec.encode(creatorSigner.address),
		]);

		const accounts = [
			{ address: mintAddress, role: AccountRole.WRITABLE_SIGNER },
			{ address: mintAuthorityPda, role: AccountRole.READONLY },
			{ address: bondingCurvePda, role: AccountRole.WRITABLE },
			{ address: bcurveAta, role: AccountRole.WRITABLE },
			{ address: globalAccountPda, role: AccountRole.READONLY },
			{
				address: MPL_TOKEN_METADATA_PROGRAM_ADDRESS,
				role: AccountRole.READONLY,
			},
			{ address: metadataPda, role: AccountRole.WRITABLE },
			{ address: creatorSigner.address, role: AccountRole.WRITABLE_SIGNER },
			{ address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY },
			{ address: eventAuthorityPda, role: AccountRole.READONLY },
			{ address: this.programAddress, role: AccountRole.READONLY },
		];

		return {
			programAddress: this.programAddress,
			accounts,
			data: ixData,
		};
	}

	async createTokenMetadata(create: CreateTokenMetadata) {
		if (!(create.file instanceof Blob)) {
			throw new Error("File must be a Blob or File object");
		}

		let formData = new FormData();
		formData.append("file", create.file, "image.png");
		formData.append("name", create.name);
		formData.append("symbol", create.symbol);
		formData.append("description", create.description);
		formData.append("twitter", create.twitter || "");
		formData.append("telegram", create.telegram || "");
		formData.append("website", create.website || "");
		formData.append("showName", "true");

		try {
			const request = await fetch("https://pump.fun/api/ipfs", {
				method: "POST",
				headers: {
					Accept: "application/json",
				},
				body: formData,
				credentials: "same-origin",
			});

			if (request.status === 500) {
				const errorText = await request.text();
				throw new Error(
					`Server error (500): ${errorText || "No error details available"}`
				);
			}

			if (!request.ok) {
				throw new Error(`HTTP error! status: ${request.status}`);
			}

			const responseText = await request.text();
			if (!responseText) {
				throw new Error("Empty response received from server");
			}

			try {
				return JSON.parse(responseText);
			} catch (e) {
				throw new Error(`Invalid JSON response: ${responseText}`);
			}
		} catch (error) {
			console.error("Error in createTokenMetadata:", error);
			throw error;
		}
	}

	async buy(
		mintAddress: Address,
		buyerSigner: KeyPairSigner,
		tokenOutputAmount: bigint,
		slippageBp: bigint = 500n,
		priorityFees?: PriorityFee,
		commitment: Commitment = DEFAULT_COMMITMENT,
		simulate: boolean = false
	): Promise<TransactionResult> {
		const [bcurvePda] = await this.getBondingCurveAccountPda(mintAddress);
		const { value: bcurveInfo } = await this.rpc
			.getAccountInfo(bcurvePda, {
				commitment,
				encoding: "base64",
			})
			.send();
		if (!bcurveInfo)
			throw new Error("Bonding curve account not found on-chain");

		const { value: blockhash } = await this.rpc.getLatestBlockhash().send();
		let txMessage = await pipe(
			createTransactionMessage({ version: 0 }),
			(tx) => setTransactionMessageFeePayerSigner(buyerSigner, tx),
			(tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
			async (tx) =>
				await this.addAtaCreateIxIfNeeded(
					tx,
					mintAddress,
					buyerSigner.address,
					buyerSigner
				)
		);

		// TODO is this true ?
		// sycnhronous function cannot follow async function in the pipe
		// so we append buy ixs outside the pipe
		txMessage = await appendTransactionMessageInstructions(
			[
				await this.getBuyIx(
					buyerSigner,
					mintAddress,
					tokenOutputAmount,
					slippageBp
				),
			],
			txMessage
		);

		if (priorityFees) {
			const budgetIxs = await this.getComputeBudgetIxs(priorityFees, txMessage);
			for (const ix of budgetIxs) {
				txMessage = prependTransactionMessageInstructions([ix], txMessage);
			}
		}

		const signedTx = await signTransaction(
			[buyerSigner.keyPair],
			compileTransaction(txMessage)
		);

		try {
			await this.sendAndConfirm(signedTx, {
				commitment,
			});

			info(`[SDK] buyTx ${commitment}:`, getSignatureFromTransaction(signedTx));
			return {
				success: true,
				signature: signature.toString(),
			};
		} catch (e) {
			if (
				isSolanaError(
					e,
					SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
				)
			) {
				console.error(e);
			} else {
				throw e;
			}
			return {
				success: false,
				error: e.message,
			};
		}
	}

	async buyWithSol(
		mintAddress: Address,
		buyerSigner: KeyPairSigner,
		solLamports: bigint,
		slippageBp: bigint = 500n
	) {
		const curveAccount = await this.getBondingCurveAccount(mintAddress);
		const tokenOutputAmount =
			curveAccount.getTokenOutputForLamports(solLamports);
		return this.buy(mintAddress, buyerSigner, tokenOutputAmount, slippageBp);
	}

	async getBuyIx(
		buyerSigner: KeyPairSigner,
		mintAddress: Address,
		tokenOutputAmount: bigint,
		slippageBp: bigint = 500n,
		overrideCreator?: Address
	): Promise<PumpfunTradeIx> {
		const globalAccount = await this.getGlobalAccount();

		const [[globalPda], [bcurvePda], [eventAuthPda]] = await Promise.all([
			this.getGlobalAccountPda(),
			this.getBondingCurveAccountPda(mintAddress),
			this.getEventAuthorityAccountPda(),
		]);

		const bondingCurveCreator =
			overrideCreator ?? (await this.rpcGetBondingCurveCreator(bcurvePda));

		if (!bondingCurveCreator)
			throw new Error("Bonding curve creator not found");

		const [creatorVaultPda] = await this.getCreatorVaultPda(
			bondingCurveCreator
		);

		const [bcurveAta] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: bcurvePda,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});

		const [userAta] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: buyerSigner.address,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});

		info(`[SDK] tokenOutputAmount: ${tokenOutputAmount}`);

		const ixData = new Uint8Array([
			...BUY_IX_DISCRIMINATOR,
			...this.u64Encoder.encode(tokenOutputAmount),
			...this.u64Encoder.encode(
				tokenOutputAmount +
					(tokenOutputAmount * slippageBp) / BASIS_POINTS_DIVISOR
			),
		]);

		const accounts = [
			{ address: globalPda, role: AccountRole.READONLY },
			{ address: globalAccount.feeRecipient, role: AccountRole.WRITABLE },
			{ address: mintAddress, role: AccountRole.READONLY },
			{ address: bcurvePda, role: AccountRole.WRITABLE },
			{ address: bcurveAta, role: AccountRole.WRITABLE },
			{ address: userAta, role: AccountRole.WRITABLE },
			{ address: buyerSigner.address, role: AccountRole.WRITABLE_SIGNER },
			{ address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: creatorVaultPda, role: AccountRole.WRITABLE },
			{ address: eventAuthPda, role: AccountRole.READONLY },
			{ address: this.programAddress, role: AccountRole.READONLY },
		];

		return {
			programAddress: this.programAddress,
			accounts,
			data: ixData,
		};
	}

	async sell(
		mintAddress: Address,
		sellerSigner: KeyPairSigner,
		sellAmountTokens: bigint,
		slippageBp: bigint = 500n,
		priorityFees?: PriorityFee,
		commitment: Commitment = DEFAULT_COMMITMENT,
		simulate: boolean = false
	): Promise<TransactionResult> {
		const [bcurvePda] = await this.getBondingCurveAccountPda(mintAddress);

		const { value: bcurveInfo } = await this.rpc
			.getAccountInfo(bcurvePda, {
				commitment,
				encoding: "base64",
			})
			.send();
		if (!bcurveInfo)
			throw new Error("Bonding curve account not found on-chain");

		const { value: blockhash } = await this.rpc.getLatestBlockhash().send();
		let txMessage = await pipe(
			createTransactionMessage({ version: 0 }),
			(tx) => setTransactionMessageFeePayerSigner(sellerSigner, tx),
			(tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx)
		);

		txMessage = await appendTransactionMessageInstructions(
			[
				await this.getSellIx(
					sellerSigner,
					mintAddress,
					sellAmountTokens,
					slippageBp
				),
			],
			txMessage
		);

		if (priorityFees) {
			const budgetIxs = await this.getComputeBudgetIxs(priorityFees, txMessage);
			for (const ix of budgetIxs) {
				txMessage = prependTransactionMessageInstructions([ix], txMessage);
			}
		}

		// if (simulate) {
		// 	return this.simulate(txMessage);
		// }

		const signedTx = await signTransaction(
			[sellerSigner.keyPair],
			compileTransaction(txMessage)
		);
		try {
			const signature = getSignatureFromTransaction(signedTx);
			await this.sendAndConfirm(signedTx, { commitment });
			info(`[SDK] sellTx ${commitment}:`, signature);
			return { success: true, signature };
		} catch (e) {
			// handle RPC error codes as in buy()
			if (
				isSolanaError(
					e,
					SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
				)
			) {
				console.error(e);
				return { success: false, error: e.message };
			}
			throw e;
		}
	}

	async getSellIx(
		sellerSigner: KeyPairSigner,
		mintAddress: Address,
		sellAmountTokens: bigint,
		slippageBp: bigint = 500n,
		overrideCreator?: Address
	) {
		const globalAccount = await this.getGlobalAccount();
		if (!globalAccount) throw new Error("Global account not found on-chain");

		const bcurveAccount = await this.getBondingCurveAccount(mintAddress);
		if (!bcurveAccount)
			throw new Error("Bonding curve account not found on-chain");

		const [[globalPda], [bcurvePda], [eventAuthPda]] = await Promise.all([
			this.getGlobalAccountPda(),
			this.getBondingCurveAccountPda(mintAddress),
			this.getEventAuthorityAccountPda(),
		]);

		const [bcurveAta] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: bcurvePda,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});

		const [userAta] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: sellerSigner.address,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});

		const bondingCurveCreator =
			overrideCreator ?? (await this.rpcGetBondingCurveCreator(bcurvePda));
		const [creatorVaultPda] = await this.getCreatorVaultPda(
			bondingCurveCreator
		);

		// estimate in lamports
		const expectedSol = await bcurveAccount.getNetLamportsForTokenSell(
			sellAmountTokens,
			globalAccount.feeBasisPoints
		);

		// TODO test ts
		let sellAmountWithSlippage = (expectedSol * (10000n - slippageBp)) / 10000n;

		// ensure sells are at least 1 lamport
		if (sellAmountWithSlippage < 1n) sellAmountWithSlippage = 1n;

		info(
			"expectedSol:",
			expectedSol.toString(),
			"sellAmountWithSlippage:",
			sellAmountWithSlippage.toString()
		);

		const ixData = new Uint8Array([
			...SELL_IX_DISCRIMINATOR,
			...this.u64Encoder.encode(sellAmountTokens),
			...this.u64Encoder.encode(sellAmountWithSlippage),
		]);

		const accounts = [
			{ address: globalPda, role: AccountRole.READONLY },
			{ address: globalAccount.feeRecipient, role: AccountRole.WRITABLE },
			{ address: mintAddress, role: AccountRole.READONLY },
			{ address: bcurvePda, role: AccountRole.WRITABLE },
			{ address: bcurveAta, role: AccountRole.WRITABLE },
			{ address: userAta, role: AccountRole.WRITABLE },
			{ address: sellerSigner.address, role: AccountRole.WRITABLE_SIGNER },
			{ address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: creatorVaultPda, role: AccountRole.WRITABLE },
			{ address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
			{ address: eventAuthPda, role: AccountRole.READONLY },
			{ address: this.programAddress, role: AccountRole.READONLY },
		];

		return {
			programAddress: this.programAddress,
			accounts,
			data: ixData,
		};
	}

	async addAtaCreateIxIfNeeded(
		// TODO ensure proper type for txMessage
		txMessage: any,
		mintAddress: Address,
		ownerAddress: Address,
		feePayerSigner: KeyPairSigner
	): Promise<any> {
		const [ownerAta] = await findAssociatedTokenPda({
			mint: mintAddress,
			owner: ownerAddress,
			tokenProgram: TOKEN_PROGRAM_ADDRESS,
		});

		const { value } = await this.rpc
			.getAccountInfo(ownerAta, {
				commitment: DEFAULT_COMMITMENT,
				encoding: "base64",
			})
			.send();

		if (!value) {
			info("[SDK] adding create ATA instruction");
			appendTransactionMessageInstructions(
				[
					await getCreateAssociatedTokenInstructionAsync({
						payer: feePayerSigner,
						mint: mintAddress,
						owner: ownerAta,
					}),
				],
				txMessage
			);
		}

		return txMessage;
	}

	async getComputeBudgetIxs(
		priorityFee: PriorityFee,
		txMessage?: any,
		estimateBudget: boolean = false
	) {
		const ixs = [];

		if (estimateBudget && txMessage) {
			const estimatedUnits = await this.computeUnitEstimator(txMessage);
			ixs.push(getSetComputeUnitLimitInstruction({ units: estimatedUnits }));
		} else if (priorityFee.unitLimit !== undefined) {
			ixs.push(
				getSetComputeUnitLimitInstruction({
					units: priorityFee.unitLimit,
				})
			);
		}

		if (priorityFee.unitPrice !== undefined) {
			ixs.push(
				getSetComputeUnitPriceInstruction({
					microLamports: priorityFee.unitPrice,
				})
			);
		}

		return ixs;
	}

	async getGlobalAccount(): Promise<GlobalAccount | null> {
		const [globalAccountPda] = await this.getGlobalAccountPda();
		const { value } = await this.rpc
			.getAccountInfo(globalAccountPda, {
				commitment: DEFAULT_COMMITMENT,
				encoding: "base64",
			})
			.send();

		if (!value || !value?.data) return null;

		return GlobalAccount.fromUint8Array(
			this.base64Encoder.encode(value.data[0])
		);
	}

	async getBondingCurveAccount(
		mintAddress: Address
	): Promise<BondingCurveAccount | null> {
		const [bondingCurvePda] = await this.getBondingCurveAccountPda(mintAddress);
		const { value } = await this.rpc
			.getAccountInfo(bondingCurvePda, {
				commitment: DEFAULT_COMMITMENT,
				encoding: "base64",
			})
			.send();

		if (!value || !value?.data) return null;

		return BondingCurveAccount.fromUint8Array(
			this.base64Encoder.encode(value.data[0])
		);
	}

	private async rpcGetBondingCurveCreator(
		bondingCurvePda: Address,
		commitment: Commitment = DEFAULT_COMMITMENT
	): Promise<Address> {
		const { value } = await this.rpc
			.getAccountInfo(bondingCurvePda, {
				commitment,
				encoding: "base64",
			})
			.send();

		if (!value || !value?.data) return null;

		const accountBytes = this.base64Encoder.encode(value.data[0]);

		// `creator` (32 bytes length) is at offset 49
		// after 8 bytes discriminator + 5*u64 fields + 1 byte boolean
		const creatorBytes = accountBytes.subarray(49, 49 + 32);
		return this.addressCodec.decode(creatorBytes);
	}

	private async getBondingCurveAccountPda(
		mintAddress: Address
	): Promise<ProgramDerivedAddress> {
		return await getProgramDerivedAddress({
			programAddress: this.programAddress,
			seeds: [BONDING_CURVE_SEED, this.addressCodec.encode(mintAddress)],
		});
	}

	private async getGlobalAccountPda(): Promise<ProgramDerivedAddress> {
		return await getProgramDerivedAddress({
			programAddress: this.programAddress,
			seeds: [GLOBAL_ACCOUNT_SEED],
		});
	}

	private async getEventAuthorityAccountPda(): Promise<ProgramDerivedAddress> {
		return getProgramDerivedAddress({
			programAddress: this.programAddress,
			seeds: [EVENT_AUTHORITY_SEED],
		});
	}

	private async getCreatorVaultPda(
		creator: Address
	): Promise<ProgramDerivedAddress> {
		return getProgramDerivedAddress({
			programAddress: this.programAddress,
			seeds: [CREATOR_VAULT_SEED, this.addressCodec.encode(creator)],
		});
	}
}

async function main() {
	const buyerSigner = await getOrCreateKeypairSigner(
		"./keypairs/test_keypair.json"
	);

	const newMintSigner = await getOrCreateKeypairSigner(
		"./keypairs/new_test_mint_keypair.json"
	);

	const sdk = new PumpfunSdk(buyerSigner, config.DEVNET_RPC_URL);

	const tokenMetadata: CreateTokenMetadata = {
		name: "Test Token 2",
		symbol: "TTKK",
		description: "This is a test token again",
		file: await openAsBlob("./assets/random.png"),
		twitter: "https://twitter.com/test_token",
		telegram: "https://t.me/test_token",
		website: "https://testtoken.com",
	};

	const rpc = createSolanaRpc(config.DEVNET_RPC_URL);

	printTokenBalance(
		rpc,
		newMintSigner.address,
		buyerSigner.address,
		"before buy"
	);

	await sdk.buy(
		newMintSigner.address,
		buyerSigner,
		BigInt(0.01 * LAMPORTS_PER_SOL)
	);

	printTokenBalance(
		rpc,
		newMintSigner.address,
		buyerSigner.address,
		"after buy"
	);

	await sdk.sell(
		newMintSigner.address,
		buyerSigner,
		await getTokenBalance(rpc, newMintSigner.address, buyerSigner.address)
	);

	printTokenBalance(
		rpc,
		newMintSigner.address,
		buyerSigner.address,
		"after sell"
	);
}

// main().catch((e) => {
// 	error(e);
// });
