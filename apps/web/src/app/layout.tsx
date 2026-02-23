import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "@/app/globals.css";
import { GitHubLink } from "@/components/github-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { resolveTheme, THEME_COOKIE_NAME } from "@/lib/theme";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "Agentloom — One agent config. Every AI tool.",
  description:
    "Define your AI agents, skills, commands, and MCP servers once. Sync them to Cursor, Claude, Copilot, Codex, OpenCode, and Gemini in one command.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = resolveTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${plexMono.variable} ${theme === "dark" ? "dark" : ""}`}
    >
      <body className="font-display text-ink antialiased">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="flex items-center justify-end gap-2 py-4">
            <GitHubLink />
            <ThemeToggle initialTheme={theme} />
          </div>
          <div className="pb-20">{children}</div>
        </div>
      </body>
    </html>
  );
}
