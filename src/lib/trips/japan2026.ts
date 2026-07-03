import type { TripConfig } from "./types";

/**
 * Japan 2026 trip.
 *
 * To create a new trip: copy this file, change the fields, then register the
 * config in ./index.ts. The trip page will be served at /trips/<slug>.
 */
export const japan2026: TripConfig = {
  slug: "japan2026",
  name: "Japan 2026",
  memberIds: [6, 7, 3], // Leon, Timmy, Danny
  startDate: "2026-08-26",
  endDate: "2026-09-10",
  // Add { label, value } pairs here to show details under the trip header,
  // e.g. { label: "Hotel", value: "Shinjuku Granbell" }
  details: [],
  currencies: [
    { code: "CAD", symbol: "$", decimals: 2 },
    { code: "JPY", symbol: "¥", decimals: 0 },
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
