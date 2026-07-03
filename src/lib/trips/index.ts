import type { TripConfig } from "./types";
import { japan2026 } from "./japan2026";
import { testtrip } from "./testtrip";

/** All trips, in display order. Register new trip configs here. */
export const TRIPS: TripConfig[] = [japan2026, testtrip];

export function getTripBySlug(slug: string): TripConfig | undefined {
  return TRIPS.find((t) => t.slug === slug);
}

export * from "./types";
