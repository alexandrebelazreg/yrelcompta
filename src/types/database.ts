export type MembershipRole = "owner" | "member" | "accountant";
export type DeclarationPeriod = "monthly" | "quarterly";
export type VatRegime = "franchise" | "liable";

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

export interface Business {
  id: string;
  name: string;
  siret: string | null;
  address: string | null;
  main_activity: string;
}

export interface BusinessSettings {
  business_id: string;
  declaration_period: DeclarationPeriod;
  vat_regime: VatRegime;
  has_acre: boolean;
  currency: "EUR";
  timezone: "Europe/Paris";
}

export interface AppContext {
  profile: Profile | null;
  business: Business | null;
}
