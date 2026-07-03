import { notFound } from "next/navigation";
import { getTripBySlug } from "@/lib/trips";
import TripPage from "@/components/trip/TripPage";

export const dynamic = "force-dynamic";

export default async function TripSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = getTripBySlug(slug);
  if (!trip) notFound();

  return <TripPage trip={trip} />;
}
