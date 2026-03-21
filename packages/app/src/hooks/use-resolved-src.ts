import { resolveFileSrc } from "@/stores/library-store";
import { useEffect, useState } from "react";

/**
 * Hook to resolve book/cover paths (relative or absolute) to displayable asset:// URLs.
 * Handles both legacy absolute paths and new relative paths (e.g., "covers/{id}.jpg").
 */
export function useResolvedSrc(path: string | undefined): string {
  const [resolved, setResolved] = useState("");

  useEffect(() => {
    if (!path) {
      setResolved("");
      return;
    }

    // If already a displayable URL, use it directly
    if (path.startsWith("asset://") || path.startsWith("http")) {
      setResolved(path);
      return;
    }

    // Resolve the path asynchronously
    resolveFileSrc(path)
      .then(setResolved)
      .catch((err) => {
        console.warn("[useResolvedSrc] Failed to resolve path:", path, err);
        setResolved("");
      });
  }, [path]);

  return resolved;
}
