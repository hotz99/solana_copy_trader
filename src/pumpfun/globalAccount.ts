import {
	getBytesDecoder,
	getBooleanDecoder,
	getAddressDecoder,
	getU64Decoder,
	getStructDecoder,
	fixDecoderSize,
} from "@solana/kit";
import type { Address, ReadonlyUint8Array } from "@solana/kit";

// Decoder matching the on-chain GlobalAccount layout
const globalAccountDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["initialized", getBooleanDecoder()],
	["authority", getAddressDecoder()],
	["feeRecipient", getAddressDecoder()],
	["initialVirtualTokenReserves", getU64Decoder()],
	["initialVirtualSolReserves", getU64Decoder()],
	["initialRealTokenReserves", getU64Decoder()],
	["tokenTotalSupply", getU64Decoder()],
	["feeBasisPoints", getU64Decoder()],
]);

export class GlobalAccount {
	public discriminator: ReadonlyUint8Array;
	public initialized: boolean;
	public authority: Address;
	public feeRecipient: Address;
	public initialVirtualTokenReserves: bigint;
	public initialVirtualSolReserves: bigint;
	public initialRealTokenReserves: bigint;
	public tokenTotalSupply: bigint;
	public feeBasisPoints: bigint;

	constructor(fields: {
		discriminator: ReadonlyUint8Array;
		initialized: boolean;
		authority: Address;
		feeRecipient: Address;
		initialVirtualTokenReserves: bigint;
		initialVirtualSolReserves: bigint;
		initialRealTokenReserves: bigint;
		tokenTotalSupply: bigint;
		feeBasisPoints: bigint;
	}) {
		this.discriminator = fields.discriminator;
		this.initialized = fields.initialized;
		this.authority = fields.authority;
		this.feeRecipient = fields.feeRecipient;
		this.initialVirtualTokenReserves = fields.initialVirtualTokenReserves;
		this.initialVirtualSolReserves = fields.initialVirtualSolReserves;
		this.initialRealTokenReserves = fields.initialRealTokenReserves;
		this.tokenTotalSupply = fields.tokenTotalSupply;
		this.feeBasisPoints = fields.feeBasisPoints;
	}

	public static fromUint8Array(data: ReadonlyUint8Array): GlobalAccount {
		const decoded = globalAccountDecoder.decode(data);
		return new GlobalAccount({
			discriminator: decoded.discriminator,
			initialized: decoded.initialized,
			authority: decoded.authority,
			feeRecipient: decoded.feeRecipient,
			initialVirtualTokenReserves: decoded.initialVirtualTokenReserves,
			initialVirtualSolReserves: decoded.initialVirtualSolReserves,
			initialRealTokenReserves: decoded.initialRealTokenReserves,
			tokenTotalSupply: decoded.tokenTotalSupply,
			feeBasisPoints: decoded.feeBasisPoints,
		});
	}

	/** Calculate initial buy price based on virtual curve */
	public getInitialBuyPrice(amount: bigint): bigint {
		if (amount <= 0n) return 0n;
		const n = this.initialVirtualSolReserves * this.initialVirtualTokenReserves;
		const i = this.initialVirtualSolReserves + amount;
		const r = n / i + 1n;
		const s = this.initialVirtualTokenReserves - r;
		return s < this.initialRealTokenReserves
			? s
			: this.initialRealTokenReserves;
	}
}
