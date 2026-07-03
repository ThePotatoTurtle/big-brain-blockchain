import type { TripConfig } from "./types";

/**
 * Test trip.
 *
 * To create a new trip: copy this file, change the fields, then register the
 * config in ./index.ts. The trip page will be served at /trips/<slug>.
 */
export const testtrip: TripConfig = {
  slug: "testtrip",
  name: "Test Trip",
  memberIds: [1, 2, 3],
  startDate: "2026-01-01",
  endDate: "2026-01-02",
  // Add { label, value } pairs here to show details under the trip header,
  // e.g. { label: "Hotel", value: "Shinjuku Granbell" }
  details: [],
  currencies: [
    { code: "CAD", symbol: "$", decimals: 2 },
    { code: "USD", symbol: "$", decimals: 2 },
  ],
  categories: [
    "Accommodation",
    "Activities",
    "Food & Drinks",
    "Shopping",
    "Transportation",
    "Others",
  ],
  paymentMethods: ["Card", "Cash", "Other"],
};
