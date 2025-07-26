import { createSolanaRpc, signature } from "@solana/kit";
import { resolvePumpfunIxs as resolvePumpfunIxs } from "./pumpfun/decoder";
import { resolvePumpfunSellInstructions as resolvePumpfunSellInstructions } from "./pumpfun/sellDecoder";
import { resolveJupiterSwapEvents } from "./jupiter/swapEventDecoder";
import { resolvePumpfunAmmIxs } from "./pumpfun/ammDecoder";

async function main() {
	const rpcMainnet = createSolanaRpc("https://api.mainnet-beta.solana.com");
	const rpcDevnet = createSolanaRpc("https://api.devnet.solana.com");

	// const buyAmmSig =
	// 	"2G87huNvn348cxK2djAww11BmNsWCm69xymjgVogMYDpMW56u6HBDvMgB4EKMnEzVY4snfnVupCdvxnrZsHBVk7";
	// const buyAmmTxJson = await rpcMainnet
	// 	.getTransaction(signature(buyAmmSig), {
	// 		commitment: "confirmed",
	// 		encoding: "json",
	// 		maxSupportedTransactionVersion: 0,
	// 	})
	// 	.send();
	// if (!buyAmmTxJson) {
	// 	throw new Error("Transaction not found");
	// }

	// const sellAmmSig =
	// 	"47RXe1CeSRuXjx4kAkQquEiMu91VM1ALGokqvBZjGd1e7uroqLwTEeMSxBJo6Gqbms8cFaNp6PQW9Z2gvBLYtNi4";
	// const sellAmmTxJson = await rpcMainnet
	// 	.getTransaction(signature(sellAmmSig), {
	// 		commitment: "confirmed",
	// 		encoding: "json",
	// 		maxSupportedTransactionVersion: 0,
	// 	})
	// 	.send();
	// if (!sellAmmTxJson) {
	// 	throw new Error("Transaction not found");
	// }

	// const { buyIxs: ammBuys, sellIxs: ammSells } = resolvePumpfunAmmIxs(
	// 	sellAmmTxJson.transaction.message
	// );

	// console.log(ammBuys);
	// console.log(ammSells);

	// const buySig =
	// 	"2FLpvVGKSTrCSt6PNqit621746nDVQcTVit17JLsTyd7zSbrvumwym3vAtYZVGSmZiQVgVswPTGpWpw8CDHX1fdj";
	// const buyTxJson = await rpcMainnet
	// 	.getTransaction(signature(buySig), {
	// 		commitment: "confirmed",
	// 		encoding: "json",
	// 		maxSupportedTransactionVersion: 0,
	// 	})
	// 	.send();
	// if (!buyTxJson) {
	// 	throw new Error("Transaction not found");
	// }

	const sellSig =
		"NpHWJUZ7TF23ktX8xpDUswRzxRWELbqaZujn3P8URt7Pf2jqxNU1eU96gQeEcPoB5nff4tKhtpTvLwv1T1HJJC2";
	const sellTxJson = await rpcMainnet
		.getTransaction(signature(sellSig), {
			commitment: "confirmed",
			encoding: "json",
			maxSupportedTransactionVersion: 0,
		})
		.send();
	if (!sellTxJson) {
		throw new Error("Transaction not found");
	}

	const { ourBuyIxs, ourSellIxs } = resolvePumpfunIxs(
		sellTxJson.transaction.message
	);

	console.log(ourBuyIxs);
	console.log(ourSellIxs);

	// resolveJupiterSwapEvents(swapTxJson)
	//   .then(swaps => swaps.forEach(swap => {
	//     console.log(`Swap: ${swap.inputAmount} ${swap.inputMint} for ${swap.outputAmount} ${swap.outputMint} on AMM ${swap.amm}`);
	//   }))
	//   .catch(console.error);
}

main().catch((err) => console.error(err));
