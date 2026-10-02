import { HistoryApp } from "@/components/history/history-app";
import { requirePageAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  await requirePageAccess();
  return <HistoryApp />;
}
