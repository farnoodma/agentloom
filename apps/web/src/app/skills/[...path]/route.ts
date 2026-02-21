import { NextResponse } from "next/server";

interface SkillsRedirectProps {
  params: Promise<{ path?: string[] }>;
}

export async function GET(_request: Request, props: SkillsRedirectProps) {
  const params = await props.params;
  const path = params.path?.join("/") ?? "";
  const destination = path === "" ? "https://skills.sh" : `https://skills.sh/${path}`;

  return NextResponse.redirect(destination, 308);
}
