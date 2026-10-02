/**
 * Connector factory — port of connectors/__init__.py.
 */
export * from "./types";
export { MockPriceSource } from "./mock";
export { MercedesPriceSource } from "./mercedes";

import { MockPriceSource } from "./mock";
import { MercedesPriceSource } from "./mercedes";
import type { PriceSource } from "./types";

/** Factory used by the app to create the configured price source. */
export function makeSource(name: string | undefined | null): PriceSource {
  const key = (name || "mock").toLowerCase();
  if (key === "mercedes") {
    return new MercedesPriceSource();
  }
  return new MockPriceSource();
}

// normalizePart lives in ./types (client-safe); re-exported here so server
// code can keep importing everything from "@/lib/connectors".
// (export * from "./types" above already provides it.)
