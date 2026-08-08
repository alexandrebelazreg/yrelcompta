import type { VatRegime } from "@/types/database";

export type FiscalActivityCategory = "micro_bic_goods";
export type CfpCategory = "commercial" | "artisan";

export interface FiscalSocialRuleVersion {
  id: string;
  effectiveFrom: string;
  activityCategory: FiscalActivityCategory;
  socialContributionBasisPoints: number;
  cfpCommercialBasisPoints: number;
  cfpArtisanBasisPoints: number;
  versementLiberatoireBasisPoints: number;
  incomeTaxAbatementBasisPoints: number;
  microTurnoverCeilingCents: number;
  vatFranchiseBaseCeilingCents: number;
  vatFranchiseToleranceCeilingCents: number;
  sourceLabel: string;
  sourceCheckedOn: string;
}

export interface AcreRuleVersion {
  id: string;
  activityStartedFrom: string;
  paidFractionBasisPoints: number;
  durationQuartersAfterStart: number;
  rateRoundingIncrementBasisPoints: number;
  sourceLabel: string;
  sourceCheckedOn: string;
}

export interface BusinessFiscalProfile {
  id: string;
  businessId: string;
  effectiveFrom: string;
  cfpCategory: CfpCategory;
  hasAcre: boolean;
  versementLiberatoire: boolean;
  createdAt: string;
}

export interface FiscalCalculationContext {
  activityStartedOn: string | null;
  vatRegime: VatRegime;
  profile: BusinessFiscalProfile | null;
  rule: FiscalSocialRuleVersion | null;
  acreRule: AcreRuleVersion | null;
}

export interface FiscalReserveCalculation {
  turnoverCents: number;
  socialRateBasisPoints: number;
  cfpRateBasisPoints: number;
  versementLiberatoireBasisPoints: number;
  acreApplied: boolean;
  acreEndsOn: string | null;
  estimatedSocialContributionsCents: number;
  estimatedCfpCents: number;
  estimatedIncomeTaxCents: number;
  estimatedTotalReserveCents: number;
}

export type FiscalReserveUnavailableReason =
  | "refund-review-required"
  | "vat-unmodeled"
  | "profile-not-configured"
  | "rule-not-available";

export interface DashboardFiscalReserve {
  calculation: FiscalReserveCalculation | null;
  unavailableReason: FiscalReserveUnavailableReason | null;
  trackedCashAfterReserveCents: number | null;
}

export interface FiscalSettingsPageData {
  isOwner: boolean;
  activityStartedOn: string | null;
  legacyHasAcre: boolean;
  profiles: BusinessFiscalProfile[];
  activeProfile: BusinessFiscalProfile | null;
  activeRule: FiscalSocialRuleVersion | null;
  activeAcreRule: AcreRuleVersion | null;
}
