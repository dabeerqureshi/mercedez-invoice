/**
 * Connector factory — port of connectors/__init__.py.
 *
 * Always the live Mercedes source: the offline mock was removed, so every
 * lookup returns real catalog data (or fails loudly when unconfigured).
 */
export * from "./types";
export { MercedesPriceSource } from "./mercedes";

import { MercedesPriceSource } from "./mercedes";
import type { PriceSource } from "./types";

/** Factory used by the app to create the price source. */
export function makeSource(): PriceSource {
  return new MercedesPriceSource();
}

// normalizePart lives in ./types (client-safe); re-exported here so server
// code can keep importing everything from "@/lib/connectors".
// (export * from "./types" above already provides it.)
