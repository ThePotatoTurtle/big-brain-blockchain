export const USERS = [
  { id: 1, name: "Andy", email: "andy@example.com", color: "#EF4444" },     // red
  { id: 2, name: "Calvin", email: "calvin@example.com", color: "#8B5CF6" }, // purple
  { id: 3, name: "Danny", email: "danny@example.com", color: "#3B82F6" },   // blue
  { id: 4, name: "Henry", email: "henry@example.com", color: "#EC4899" },   // pink
  { id: 5, name: "Jayden", email: "jayden@example.com", color: "#F59E0B" }, // amber
  { id: 6, name: "Leon", email: "leonlin773@gmail.com", color: "#06B6D4" }, // cyan
  { id: 7, name: "Timmy", email: "timmy@example.com", color: "#10B981" },   // green
] as const;

export type UserEntry = (typeof USERS)[number];
export type UserName = UserEntry["name"];

export function getUserById(id: number): UserEntry | undefined {
  return USERS.find((u) => u.id === id);
}

export function getUserByName(name: string): UserEntry | undefined {
  return USERS.find((u) => u.name === name);
}

export function getUserColor(id: number): string {
  return getUserById(id)?.color ?? "#6B7280";
}
