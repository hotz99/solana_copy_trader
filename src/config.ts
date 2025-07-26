import dotenv from "dotenv";
import { exit } from "process";

dotenv.config();

function requiredEnv(key: string): string {
	const val = process.env[key];
	if (!val) {
		console.error(`[config] ERROR: Missing environment variable ${key}`);
		exit(1);
	}
	return val;
}

export type BotMode = "COPY" | "SELLING";
export type TradeType = "EXACT" | "SAFE";
export type DexOption =
	| "none"
	| "auto"
	| "pumpfun"
	| "meteora"
	| "raydium"
	| "moonshot"
	| "jupiter";

export interface Config {
	MAINNET_RPC_URL: string;
	DEVNET_RPC_URL: string;
	DEVNET_WSS_URL: string;
	PRIVATE_KEY: string;
	PUBLIC_KEY: string;
	BOT_MODE: BotMode;
	SOURCE_ADDRESS: string;
	TRADE_TYPE: TradeType;
	BUY_AMOUNT: number;
	TAKE_PROFIT: number;
	STOP_LOSS: number;
	SLIPPAGE_BP: number;
	JITO_TIP: number;
	JITO_ENGINE: string;
	COINVERA_API_KEY: string;
	PRICE_CHECK_DELAY_MS: number;
	PREFERRED_DEX: DexOption;
	ENABLE_MULTI_BUY: boolean;
}

const config: Config = {
	MAINNET_RPC_URL: requiredEnv("MAINNET_RPC_URL"),
	DEVNET_RPC_URL: requiredEnv("DEVNET_RPC_URL"),
	DEVNET_WSS_URL: requiredEnv("DEVNET_WSS_URL"),
	PRIVATE_KEY: requiredEnv("PRIVATE_KEY"),
	PUBLIC_KEY: requiredEnv("PUBLIC_KEY"),
	BOT_MODE: requiredEnv("BOT_MODE").toUpperCase() as BotMode,
	SOURCE_ADDRESS: requiredEnv("SOURCE_ADDRESS"),
	TRADE_TYPE: requiredEnv("TRADE_TYPE").toUpperCase() as TradeType,
	BUY_AMOUNT: parseFloat(requiredEnv("BUY_AMOUNT")),
	TAKE_PROFIT: parseFloat(requiredEnv("TAKE_PROFIT")),
	STOP_LOSS: parseFloat(requiredEnv("STOP_LOSS")),
	SLIPPAGE_BP: parseFloat(requiredEnv("SLIPPAGE_BP")),
	JITO_TIP: parseFloat(requiredEnv("JITO_TIP")),
	JITO_ENGINE: requiredEnv("JITO_ENGINE"),
	COINVERA_API_KEY: requiredEnv("COINVERA_API_KEY"),
	PRICE_CHECK_DELAY_MS: parseInt(requiredEnv("PRICE_CHECK_DELAY_MS"), 10),
	PREFERRED_DEX: (
		process.env.PREFERRED_DEX || "none"
	).toLowerCase() as DexOption,
	ENABLE_MULTI_BUY: process.env.ENABLE_MULTI_BUY === "true",
};

const validBotModes: BotMode[] = ["COPY", "SELLING"];
const validTradeTypes: TradeType[] = ["EXACT", "SAFE"];
const validDexOptions: DexOption[] = [
	"none",
	"auto",
	"pumpfun",
	"meteora",
	"raydium",
	"moonshot",
	"jupiter",
];

if (!validBotModes.includes(config.BOT_MODE)) {
	console.error(
		`[config] ERROR: BOT_MODE must be one of: ${validBotModes.join(", ")}`
	);
	exit(1);
}
if (!validTradeTypes.includes(config.TRADE_TYPE)) {
	console.error(
		`[config] ERROR: TRADE_TYPE must be one of: ${validTradeTypes.join(", ")}`
	);
	exit(1);
}
if (!validDexOptions.includes(config.PREFERRED_DEX)) {
	console.error(
		`[config] ERROR: PREFERRED_DEX must be one of: ${validDexOptions.join(
			", "
		)}`
	);
	exit(1);
}

export default config;
