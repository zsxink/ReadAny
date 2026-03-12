/**
 * Theme constants — re-exports dark colors as default for backward compat.
 * Use `useTheme()` from ThemeContext for reactive theme colors.
 */
import { darkColors, useTheme } from "./ThemeContext";
export type { ThemeColors } from "./ThemeContext";
export { useTheme } from "./ThemeContext";

/**
 * Convert a hex color to an rgba string with the given opacity.
 * Accepts 3-digit (#abc) or 6-digit (#aabbcc) hex values.
 */
export function withOpacity(hex: string, opacity: number): string {
  let r: number, g: number, b: number;
  const h = hex.replace("#", "");
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `rgba(${r},${g},${b},${opacity})`;
}

/** @deprecated Use useColors() instead for theme-aware components */
export const colors = darkColors;

/**
 * Hook to get current theme colors. Use this in component function bodies
 * so the local `colors` variable shadows the static import, making
 * StyleSheet.create fallback to dark while inline styles use the real theme.
 */
export function useColors() {
  return useTheme().colors;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
} as const;

export const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};
