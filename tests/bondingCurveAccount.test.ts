import { BondingCurveAccount } from "../src/pumpfun/bondingCurveAccount";

const baseFields = {
	discriminator: new Uint8Array(8).fill(0),
	virtualTokenReserves: 1000n,
	virtualSolReserves: 1000n,
	realTokenReserves: 100n,
	realSolReserves: 100n,
	tokenTotalSupply: 2000n,
	complete: false,
};

describe("BondingCurveAccount", () => {
	let account: BondingCurveAccount;

	beforeEach(() => {
		account = new BondingCurveAccount(baseFields);
	});

	test("initial properties are set correctly", () => {
		expect(account.virtualTokenReserves).toBe(1000n);
		expect(account.virtualSolReserves).toBe(1000n);
		expect(account.realTokenReserves).toBe(100n);
		expect(account.realSolReserves).toBe(100n);
		expect(account.tokenTotalSupply).toBe(2000n);
		expect(account.complete).toBe(false);
	});

	test("getBuyPrice returns 0n for non-positive amount", () => {
		expect(account.getTokenOutputForLamports(0n)).toBe(0n);
		expect(account.getTokenOutputForLamports(-5n)).toBe(0n);
	});

	test("getBuyPrice throws if complete", () => {
		const done = new BondingCurveAccount({ ...baseFields, complete: true });
		expect(() => done.getTokenOutputForLamports(100n)).toThrow(
			"Curve is complete"
		);
	});

	test("getBuyPrice computes correct token amount", () => {
		// with:
		// virtual reserves = 1000/1000
		// amountLamports = 100, n = 1_000_000, i = 1100
		// => r = 1_000_000/1100 + 1 = 909 + 1 = 910
		// => s = 1000 - 910 = 90
		expect(account.getTokenOutputForLamports(100n)).toBe(90n);
	});

	test("getSellPrice returns 0n for non-positive amount", () => {
		expect(account.getNetLamportsForTokenSell(0n, 10n)).toBe(0n);
		expect(account.getNetLamportsForTokenSell(-10n, 10n)).toBe(0n);
	});

	test("getSellPrice computes correct SOL out minus fee", () => {
		// amount=100, feeBP=10
		// => n=100*1000/(1000+100)=100000/1100=90, fee=90*10/10000=0
		expect(account.getNetLamportsForTokenSell(100n, 10n)).toBe(90n);
	});

	test("getOutputPrice computes correct sell value plus fee", () => {
		// tokenAmount=100, feeBP=10
		// => totalSellValue=(100*1000)/(900)+1=111+1=112, fee=112*10/10000=0
		expect(account.getGrossLamportsForTokenSell(100n, 10n)).toBe(112n);
	});

	test("getMarketCapLamports computes correct market cap", () => {
		// tokenTotalSupply=2000 * virtualSolReserves=1000 / virtualTokenReserves=1000 = 2000
		expect(account.getMarketCapLamports()).toBe(2000n);
	});

	test("getFinalMarketCapLamports computes correct value", () => {
		// realTokenReserves=100, feeBP=10
		// totalSell=getOutputPrice(100,10)=112
		// totalVirtualVal=1000+112=1112
		// totalVirtualTokens=1000-100=900
		// result=2000*1112/900= (2_224_000/900)=2471
		expect(account.getFinalMarketCapLamports(10n)).toBe(2471n);
	});
});
