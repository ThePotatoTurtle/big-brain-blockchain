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
    { code: "CAD", symbol: "$", decimals: 2, axisStep: 10000 }, // $100 ticks
    { code: "JPY", symbol: "¥", decimals: 0, axisStep: 10000 }, // ¥10,000 ticks
  ],
  // Ordered by expected entry frequency (most-used first — it's a required
  // field on every entry). Boundary rules:
  //   Restaurants        — prepared/made-to-order: restaurants, bars, cafés,
  //                        izakaya, street food & market stalls.
  //   Konbini & Vending  — pre-packaged/self-serve: konbini, vending machines,
  //                        supermarkets, packaged snacks.
  //   Shopping vs Activities — take home an object → Shopping;
  //                            consume an experience → Activities.
  categories: [
    "Restaurants",
    "Konbini & Vending",
    "Shopping",
    "Activities",
    "Transportation",
    "Accommodation",
    "Flights",
    "Others",
  ],
  paymentMethods: ["Card", "Cash", "Other"],
};
