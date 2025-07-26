// import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
// import { Jupiter, RouteInfo, TOKEN_LIST_URL } from "@jup-ag/core";
// import JSBI from "jsbi";
// import path from "path";
// import { getOrCreateKeypair, getSplBalance } from "../utils";

// const MAX_ITERATIONS = 5;
// const INTERVAL_MS = 5_000;
// const SLIPPAGE_BPS = 50;
// const DEVNET_RPC = "https://api.devnet.solana.com";

// const KEYPAIRS_DIR = path.join(__dirname, "../keys");
// // adjust this to the mint you want to trade against SOL, e.g. USDC on devnet
// const DEVNET_USDC_MINT = new PublicKey("HNZ3NfTVgyytjQbH8EPJK1jUqQ1nvsL5123T3C8tVnJh");

// type WalletAdapter = {
//     publicKey: PublicKey;
//     signTransaction(tx: Transaction): Promise<Transaction>;
//     signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
// };

// export async function simulateJupiterSwaps(sourceKeypair: Keypair) {
//     const connection = new Connection(DEVNET_RPC, "confirmed");

//     // wrap our Keypair into a minimal WalletAdapter
//     const wallet: WalletAdapter = {
//         publicKey: sourceKeypair.publicKey,
//         signTransaction: async (tx: Transaction) => {
//             tx.partialSign(sourceKeypair);
//             return tx;
//         },
//         signAllTransactions: async (txs: Transaction[]) => {
//             txs.forEach((tx) => tx.partialSign(sourceKeypair));
//             return txs;
//         },
//     };

//     // load the Jupiter SDK
//     const jupiter = await Jupiter.load({
//         connection,
//         cluster: "devnet",
//         user: wallet,
//         tokenListUrl: TOKEN_LIST_URL.DEVNET,
//     });

//     // locate wrapped SOL and USDC in the token list
//     const tokenMap = jupiter.tokenMap;
//     const solToken = Array.from(tokenMap.values()).find((t) => t.symbol === "SOL");
//     if (!solToken) throw new Error("SOL token not found in Jupiter token list");

//     // use a custom USDC mint on devnet or
//     // you can also locate by symbol:
//     // const usdcToken = Array.from(tokenMap.values()).find((t) => t.symbol === "USDC");
//     // if (!usdcToken) throw ...
//     const usdcTokenMint = DEVNET_USDC_MINT;

//     let toggle = true;
//     let count = 0;

//     while (count < MAX_ITERATIONS) {
//         try {
//             const inputMint = toggle ? solToken.address : usdcTokenMint;
//             const outputMint = toggle ? usdcTokenMint : solToken.address;
//             const amount = toggle
//                 ? JSBI.BigInt(0.01 * LAMPORTS_PER_SOL)
//                 : (() => {
//                     // for USDC -> SOL, sell your entire USDC balance
//                     return JSBI.BigInt(
//                         (await getSplBalance(connection, inputMint, sourceKeypair.publicKey) || 0) *
//                         10 ** solToken.decimals
//                     );
//                 })();

//             console.log(
//                 `${toggle ? "SWAP SOL→USDC" : "SWAP USDC→SOL"}  | amount: ${amount.toString()}`
//             );

//             // compute routes
//             const routes = await jupiter.computeRoutes({
//                 inputMint,
//                 outputMint,
//                 amount,
//                 slippageBps: SLIPPAGE_BPS,
//                 forceFetch: true,
//             });

//             if (routes.routesInfos.length === 0) {
//                 console.warn("no routes found for this pair / amount");
//                 break;
//             }

//             const bestRoute: RouteInfo = routes.routesInfos[0];
//             // execute
//             const swapResult = await jupiter.exchange({
//                 routeInfo: bestRoute,
//                 userPublicKey: wallet.publicKey,
//                 wrapUnwrapSOL: true,
//             });

//             if (swapResult.error) {
//                 console.error("swap error:", swapResult.error);
//             } else {
//                 console.log(
//                     `Transaction submitted: https://explorer.solana.com/tx/${swapResult.transactionSignature}?cluster=devnet`
//                 );
//             }
//         } catch (e: any) {
//             console.error("swap iteration error:", e.message);
//         }

//         toggle = !toggle;
//         count++;
//         await new Promise((r) => setTimeout(r, INTERVAL_MS));
//     }

//     console.log("Jupiter swap simulation completed");
// }