import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email("Saisissez une adresse e-mail valide."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

export const onboardingSchema = z.object({
  businessName: z.string().trim().min(2, "Le nom commercial est requis.").max(120),
  firstName: z.string().trim().min(1, "Le prénom est requis.").max(80),
  lastName: z.string().trim().min(1, "Le nom est requis.").max(80),
  siret: z.union([
    z.literal(""),
    z.string().regex(/^\d{14}$/, "Le SIRET doit contenir 14 chiffres."),
  ]),
  address: z.string().trim().max(300),
  mainActivity: z.string().trim().min(2).max(160),
  declarationPeriod: z.enum(["monthly", "quarterly"]),
  vatRegime: z.enum(["franchise", "liable"]),
  hasAcre: z.enum(["yes", "no"]),
});

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}
