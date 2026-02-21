export const THEME_COOKIE_NAME = "agentloom-theme";

export type ThemeMode = "light" | "dark";

export function resolveTheme(value: string | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}
