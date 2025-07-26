import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { getIsoTimestamp } from "./utils";
import { Address } from "@solana/kit";
import { DexOption, TradeType } from "./config";

const positionsFilePath = path.join(__dirname, "../data/positions.json");

export type PositionStatus = "active" | "closed";

export interface Position {
	id: string;
	isoTimestamp: string;
	mintAddress: Address;
	buyAmount: number | string | bigint;
	tokenAmount: string;
	entryPrice: number;
	currentPrice: number;
	status: PositionStatus;
	tradeType: TradeType;
	parentSignature: string | null;
	stopLossPercentage: number | null;
	takeProfitPercentage: number | null;
	dex: DexOption;
}

export interface PositionInput {
	mintAddress: Address;
	buyAmount: number | string | bigint;
	tokenAmount: string;
	entryPrice: number;
	tradeType: TradeType;
	parentSignature?: string;
	stopLossPercentage?: number;
	takeProfitPercentage?: number;
	dex: DexOption;
}

// TODO this seems retarded
export function initStorage(): void {
	if (!fs.existsSync(positionsFilePath)) {
		const dir = path.dirname(positionsFilePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		persistPositions([]);
	} else {
		if (!loadPositions()) {
			persistPositions([]);
		}
	}
}

function persistPositions(positions: Position[]): void {
	fs.writeFileSync(
		positionsFilePath,
		JSON.stringify(positions, null, 2),
		"utf-8"
	);
}

function loadPositions(): Position[] {
	try {
		const raw = fs.readFileSync(positionsFilePath, "utf-8");
		const json = JSON.parse(raw);
		if (
			typeof json !== "object" ||
			json === null ||
			!Array.isArray((json as any).positions)
		) {
			return [];
		}
		return json as Position[];
	} catch {
		return [];
	}
}

export function getActivePositions(): Position[] {
	const positions = loadPositions();
	return positions.filter((p) => p.status === "active");
}

export function addPosition(input: PositionInput): Position {
	const positions = loadPositions();
	const newPosition: Position = {
		id: uuidv4(),
		isoTimestamp: getIsoTimestamp(),
		mintAddress: input.mintAddress,
		buyAmount: input.buyAmount,
		tokenAmount: input.tokenAmount,
		entryPrice: input.entryPrice,
		currentPrice: input.entryPrice,
		status: "active",
		tradeType: input.tradeType,
		parentSignature: input.parentSignature ?? null,
		stopLossPercentage: input.stopLossPercentage ?? null,
		takeProfitPercentage: input.takeProfitPercentage ?? null,
		dex: input.dex,
	};
	positions.push(newPosition);
	persistPositions(positions);
	return newPosition;
}

export function updatePosition(
	id: string,
	updates: Partial<Omit<Position, "id" | "time" | "mint">>
): Position {
	const positions = loadPositions();

	const idx = positions.findIndex((p) => p.id === id);
	if (idx === -1) throw new Error(`Position with id ${id} not found`);

	positions[idx] = { ...positions[idx], ...updates };
	persistPositions(positions);

	return positions[idx];
}
