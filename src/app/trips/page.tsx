import Link from "next/link";
import { TRIPS } from "@/lib/trips";
import { getUserById } from "@/lib/users";
import { formatDate } from "@/lib/utils";

export default function TripsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold">Trips & Events</h1>

      <div className="space-y-3">
        {TRIPS.map((t) => (
          <Link
            key={t.slug}
            href={`/trips/${t.slug}`}
            className="block bg-card rounded-xl p-4 hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-accent">{t.name}</p>
                <p className="text-xs text-muted mt-0.5">
                  {formatDate(t.startDate)} – {formatDate(t.endDate)}
                </p>
              </div>
              <div className="flex -space-x-1">
                {t.memberIds.map((id) => {
                  const u = getUserById(id);
                  return (
                    <div
                      key={id}
                      title={u?.name}
                      className="w-6 h-6 rounded-full border-2 border-card flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: u?.color ?? "#6B7280" }}
                    >
                      {u?.name?.[0]}
                    </div>
                  );
                })}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
