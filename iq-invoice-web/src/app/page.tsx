import { PosApp } from "@/components/pos/pos-app";
import { requirePageAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requirePageAccess();
  return <PosApp />;
}
