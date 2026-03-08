/**
 * App — Tab-driven layout. No react-router page switching.
 * All opened tabs stay mounted; visibility controlled by CSS display.
 */
import { AppLayout } from "@/components/layout/AppLayout";
import { useSyncEvents, useAutoSync } from "@/hooks/use-sync";
import { Toaster } from "sonner";

export default function App() {
  useSyncEvents();
  useAutoSync();

  return (
    <>
      <AppLayout />
      <Toaster position="top-center" richColors duration={2000} />
    </>
  );
}
