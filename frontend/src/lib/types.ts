// Frontend-local types (re-exports and extensions)
// Most types come from @roadmap/shared — this file is for UI-only types

export interface SlideMatchResult {
  investmentMatch?: {
    existingRowId: string;
    existingName: string;
    similarity: number;
    existingTacticCount: number;
    domain?: string;
    pillar?: string;
  };
  tacticMatches: Array<{
    draftTacticName: string;
    existingTacticId: string;
    existingTacticName: string;
    existingRowId: string;
    existingInvestmentName: string;
    similarity: number;
    isSameInvestment: boolean;
  }>;
  newTactics: string[];
}
