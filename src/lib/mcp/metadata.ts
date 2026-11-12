export const MCP_PATH = "/api/mcp";
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** Adresse publique du site, d'après la requête reçue (Netlify transmet l'hôte public). */
export function publicOrigin(requestUrl: string): string {
  return new URL(requestUrl).origin;
}

/** Métadonnées RFC 9728 : indiquent à Claude que Supabase Auth délivre les jetons de ce serveur. */
export function protectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [`${supabaseUrl.replace(/\/+$/, "")}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "YrelCompta",
    resource_documentation: `${origin}/parametres/claude`,
  };
}

/** En-tête de la réponse 401, qui pointe vers les métadonnées (RFC 9728 §5.1). */
export function wwwAuthenticate(origin: string, error?: string, description?: string): string {
  const parts = [`resource_metadata="${origin}${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(", ")}`;
}
