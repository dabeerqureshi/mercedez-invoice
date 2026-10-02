/**
 * Offline deterministic price source — port of connectors/mock.py.
 *
 * Lets the whole scan -> price -> cart -> VAT/discount -> PDF -> email
 * pipeline be developed and tested with no network and no Mercedes login.
 * The pseudo-price is derived deterministically from the part number so it is
 * repeatable for testing (identical output to the Python implementation).
 */
import { createHash } from "crypto";

import { CURRENCY_CODE } from "../config";
import { PriceResult, PriceSource, nowIso } from "./types";

const NAMES = [
  "BATTERY PACK",
  "BRAKE DISC",
  "OIL FILTER",
  "SPARK PLUG",
  "WIPER BLADE",
  "AIR FILTER",
  "CLUTCH KIT",
  "BRAKE PAD SET",
];

export class MockPriceSource implements PriceSource {
  name = "mock";

  async getPrice(partNumber: string): Promise<PriceResult> {
    const h = createHash("md5").update(partNumber, "utf-8").digest("hex");
    // 0.00 .. 499.99 pseudo-price, deterministic per part number
    const price = round2((parseInt(h.slice(0, 6), 16) % 50000) / 100.0);
    const name = NAMES[parseInt(h.slice(0, 2), 16) % NAMES.length];
    return {
      partNumber,
      price,
      currency: CURRENCY_CODE,
      retrievedAt: nowIso(),
      designation: name,
    };
  }

  get status(): string {
    return "mock (offline, test prices)";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
