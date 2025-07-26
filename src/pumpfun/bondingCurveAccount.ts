import {
	getBytesDecoder,
	getU64Decoder,
	getBooleanDecoder,
	getStructDecoder,
	fixDecoderSize,
	ReadonlyUint8Array,
} from "@solana/kit";
import { BASIS_POINTS_DIVISOR } from "../utils";

const bondingCurveAccountDecoder = getStructDecoder([
	["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
	["virtualTokenReserves", getU64Decoder()],
	["virtualSolReserves", getU64Decoder()],
	["realTokenReserves", getU64Decoder()],
	["realSolReserves", getU64Decoder()],
	["tokenTotalSupply", getU64Decoder()],
	["complete", getBooleanDecoder()],
]);

export class BondingCurveAccount {
	public discriminator: ReadonlyUint8Array;
	public virtualTokenReserves: bigint;
	public virtualSolReserves: bigint;
	public realTokenReserves: bigint;
	public realSolReserves: bigint;
	public tokenTotalSupply: bigint;
	public complete: boolean;

	constructor(fields: {
		discriminator: ReadonlyUint8Array;
		virtualTokenReserves: bigint;
		virtualSolReserves: bigint;
		realTokenReserves: bigint;
		realSolReserves: bigint;
		tokenTotalSupply: bigint;
		complete: boolean;
	}) {
		this.discriminator = fields.discriminator;
		this.virtualTokenReserves = fields.virtualTokenReserves;
		this.virtualSolReserves = fields.virtualSolReserves;
		this.realTokenReserves = fields.realTokenReserves;
		this.realSolReserves = fields.realSolReserves;
		this.tokenTotalSupply = fields.tokenTotalSupply;
		this.complete = fields.complete;
	}

	public static fromUint8Array(data: ReadonlyUint8Array): BondingCurveAccount {
		const decoded = bondingCurveAccountDecoder.decode(data);
		return new BondingCurveAccount({
			discriminator: decoded.discriminator,
			virtualTokenReserves: decoded.virtualTokenReserves,
			virtualSolReserves: decoded.virtualSolReserves,
			realTokenReserves: decoded.realTokenReserves,
			realSolReserves: decoded.realSolReserves,
			tokenTotalSupply: decoded.tokenTotalSupply,
			complete: decoded.complete,
		});
	}

	getTokenOutputForLamports(amountLamports: bigint): bigint {
		if (this.complete) throw new Error("Curve is complete");
		if (amountLamports <= 0n) return 0n;

		const n = this.virtualSolReserves * this.virtualTokenReserves;
		const i = this.virtualSolReserves + amountLamports;
		const r = n / i + 1n;
		const s = this.virtualTokenReserves - r;
		return s < this.realTokenReserves ? s : this.realTokenReserves;
	}

	getGrossLamportsForTokenSell(
		tokenUnits: bigint,
		feeBasisPoints: bigint
	): bigint {
		if (this.complete) throw new Error("Curve is complete");
		if (tokenUnits <= 0n) return 0n;

		// integer division floors
		// `+ 1n` turns the `floor` into a “round‐up by one” so we don’t underpay small trades
		return (
			(tokenUnits * this.virtualSolReserves) /
				(this.virtualTokenReserves - tokenUnits) +
			1n
		);
	}

	getNetLamportsForTokenSell(
		tokenUnits: bigint,
		feeBasisPoints: bigint
	): bigint {
		if (this.complete) throw new Error("Curve is complete");
		if (tokenUnits <= 0n) return 0n;

		const grossValue =
			(tokenUnits * this.virtualSolReserves) /
			(this.virtualTokenReserves + tokenUnits);
		const fee = (grossValue * feeBasisPoints) / BASIS_POINTS_DIVISOR;
		return grossValue - fee;
	}

	getMarketCapLamports(): bigint {
		if (this.virtualTokenReserves === 0n) return 0n;
		return (
			(this.tokenTotalSupply * this.virtualSolReserves) /
			this.virtualTokenReserves
		);
	}

	getFinalMarketCapLamports(feeBasisPoints: bigint): bigint {
		const totalSell = this.getGrossLamportsForTokenSell(
			this.realTokenReserves,
			feeBasisPoints
		);
		const totalVirtualVal = this.virtualSolReserves + totalSell;
		const totalVirtualTokens =
			this.virtualTokenReserves - this.realTokenReserves;
		if (totalVirtualTokens === 0n) return 0n;
		return (this.tokenTotalSupply * totalVirtualVal) / totalVirtualTokens;
	}
}
