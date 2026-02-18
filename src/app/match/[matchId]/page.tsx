import { MatchClient } from "@/components/match-client";

type PageProps = {
  params: Promise<{ matchId: string }>;
};

export default async function MatchPage({ params }: PageProps) {
  const { matchId } = await params;
  return <MatchClient matchId={matchId} />;
}
