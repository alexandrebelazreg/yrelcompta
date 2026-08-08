import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toSafeIntegerAmount } from "@/lib/sales/calculations";
import { getTodayInParis } from "@/lib/utils/date";
import type { VatRegime } from "@/types/database";
import type {
  AcreRuleVersion,
  BusinessFiscalProfile,
  CfpCategory,
  FiscalCalculationContext,
  FiscalSettingsPageData,
  FiscalSocialRuleVersion,
} from "@/types/fiscal-social";

const FAILURE_CODE = "FISCAL_DATA_LOAD_FAILED";

function logLoadError(code: string | undefined) {
  console.error("Lecture des paramètres fiscaux impossible", { code });
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(FAILURE_CODE);
  return value;
}

function normalizeProfile(value: Record<string, unknown>): BusinessFiscalProfile {
  return {
    id: String(value.id),
    businessId: String(value.business_id),
    effectiveFrom: String(value.effective_from),
    cfpCategory: value.cfp_category as CfpCategory,
    hasAcre: booleanValue(value.has_acre),
    versementLiberatoire: booleanValue(value.versement_liberatoire),
    createdAt: String(value.created_at),
  };
}

function normalizeRule(value: Record<string, unknown>): FiscalSocialRuleVersion {
  return {
    id: String(value.id),
    effectiveFrom: String(value.effective_from),
    activityCategory: "micro_bic_goods",
    socialContributionBasisPoints: toSafeIntegerAmount(value.social_contribution_basis_points),
    cfpCommercialBasisPoints: toSafeIntegerAmount(value.cfp_commercial_basis_points),
    cfpArtisanBasisPoints: toSafeIntegerAmount(value.cfp_artisan_basis_points),
    versementLiberatoireBasisPoints: toSafeIntegerAmount(value.versement_liberatoire_basis_points),
    incomeTaxAbatementBasisPoints: toSafeIntegerAmount(value.income_tax_abatement_basis_points),
    microTurnoverCeilingCents: toSafeIntegerAmount(value.micro_turnover_ceiling_cents),
    vatFranchiseBaseCeilingCents: toSafeIntegerAmount(value.vat_franchise_base_ceiling_cents),
    vatFranchiseToleranceCeilingCents: toSafeIntegerAmount(value.vat_franchise_tolerance_ceiling_cents),
    sourceLabel: String(value.source_label),
    sourceCheckedOn: String(value.source_checked_on),
  };
}

function normalizeAcreRule(value: Record<string, unknown>): AcreRuleVersion {
  return {
    id: String(value.id),
    activityStartedFrom: String(value.activity_started_from),
    paidFractionBasisPoints: toSafeIntegerAmount(value.paid_fraction_basis_points),
    durationQuartersAfterStart: toSafeIntegerAmount(value.duration_quarters_after_start),
    rateRoundingIncrementBasisPoints: toSafeIntegerAmount(value.rate_rounding_increment_basis_points),
    sourceLabel: String(value.source_label),
    sourceCheckedOn: String(value.source_checked_on),
  };
}

async function fiscalClient() {
  const supabase = await createClient();
  if (!supabase) throw new Error(FAILURE_CODE);
  return supabase;
}

async function getApplicableProfile(businessId: string, date: string): Promise<BusinessFiscalProfile | null> {
  const supabase = await fiscalClient();
  const { data, error } = await supabase.from("business_fiscal_profiles")
    .select("id,business_id,effective_from,cfp_category,has_acre,versement_liberatoire,created_at")
    .eq("business_id", businessId).lte("effective_from", date)
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(FAILURE_CODE);
  return data ? normalizeProfile(data as unknown as Record<string, unknown>) : null;
}

async function getApplicableRule(date: string): Promise<FiscalSocialRuleVersion | null> {
  const supabase = await fiscalClient();
  const { data, error } = await supabase.from("fiscal_social_rule_versions")
    .select("id,effective_from,activity_category,social_contribution_basis_points,cfp_commercial_basis_points,cfp_artisan_basis_points,versement_liberatoire_basis_points,income_tax_abatement_basis_points,micro_turnover_ceiling_cents,vat_franchise_base_ceiling_cents,vat_franchise_tolerance_ceiling_cents,source_label,source_checked_on")
    .eq("activity_category", "micro_bic_goods").lte("effective_from", date)
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(FAILURE_CODE);
  return data ? normalizeRule(data as unknown as Record<string, unknown>) : null;
}

async function getApplicableAcreRule(activityStartedOn: string | null): Promise<AcreRuleVersion | null> {
  if (!activityStartedOn) return null;
  const supabase = await fiscalClient();
  const { data, error } = await supabase.from("acre_rule_versions")
    .select("id,activity_started_from,paid_fraction_basis_points,duration_quarters_after_start,rate_rounding_increment_basis_points,source_label,source_checked_on")
    .lte("activity_started_from", activityStartedOn)
    .order("activity_started_from", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(FAILURE_CODE);
  return data ? normalizeAcreRule(data as unknown as Record<string, unknown>) : null;
}

export async function getFiscalCalculationContext(businessId: string, date: string): Promise<FiscalCalculationContext> {
  try {
    const supabase = await fiscalClient();
    const { data: settings, error } = await supabase.from("business_settings")
      .select("activity_started_on,vat_regime").eq("business_id", businessId).maybeSingle();
    if (error || !settings) throw new Error(FAILURE_CODE);
    const activityStartedOn = settings.activity_started_on === null ? null : String(settings.activity_started_on);
    const [profile, rule, acreRule] = await Promise.all([
      getApplicableProfile(businessId, date),
      getApplicableRule(date),
      getApplicableAcreRule(activityStartedOn),
    ]);
    return { activityStartedOn, vatRegime: settings.vat_regime as VatRegime, profile, rule, acreRule };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== FAILURE_CODE) logLoadError(FAILURE_CODE);
    throw new Error(FAILURE_CODE);
  }
}

export async function getFiscalSettingsPageData(businessId: string, userId: string): Promise<FiscalSettingsPageData> {
  try {
    const supabase = await fiscalClient();
    const today = getTodayInParis();
    const [settingsResult, membershipResult, profilesResult, activeRule] = await Promise.all([
      supabase.from("business_settings").select("activity_started_on,has_acre").eq("business_id", businessId).maybeSingle(),
      supabase.from("business_members").select("role").eq("business_id", businessId).eq("user_id", userId).maybeSingle(),
      supabase.from("business_fiscal_profiles")
        .select("id,business_id,effective_from,cfp_category,has_acre,versement_liberatoire,created_at")
        .eq("business_id", businessId).order("effective_from", { ascending: true }),
      getApplicableRule(today),
    ]);
    if (settingsResult.error || !settingsResult.data || membershipResult.error || profilesResult.error) throw new Error(FAILURE_CODE);
    const activityStartedOn = settingsResult.data.activity_started_on === null ? null : String(settingsResult.data.activity_started_on);
    const profiles = ((profilesResult.data ?? []) as unknown as Array<Record<string, unknown>>).map(normalizeProfile);
    const activeProfile = profiles.reduce<BusinessFiscalProfile | null>(
      (latest, profile) => profile.effectiveFrom <= today ? profile : latest,
      null,
    );
    const activeAcreRule = activeProfile?.hasAcre ? await getApplicableAcreRule(activityStartedOn) : null;
    return {
      isOwner: membershipResult.data?.role === "owner",
      activityStartedOn,
      legacyHasAcre: booleanValue(settingsResult.data.has_acre),
      profiles,
      activeProfile,
      activeRule,
      activeAcreRule,
    };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== FAILURE_CODE) logLoadError(FAILURE_CODE);
    throw new Error(FAILURE_CODE);
  }
}
