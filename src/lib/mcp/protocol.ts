import { z } from "zod";

/** Versions du protocole MCP acceptées ; la plus récente est proposée par défaut. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_INFO = { name: "yrelcompta", title: "YrelCompta", version: "1.0.0" };
export const SERVER_INSTRUCTIONS = "YrelCompta est l’outil de gestion d’une micro-entreprise française de bijoux. Les montants sont en euros TTC. Les estimations de coût, de marge et de rentabilité sont internes : ce ne sont ni des résultats comptables ni des montants fiscaux dus. Avant toute création ou modification, récapitulez ce qui va être enregistré et attendez l’accord de l’utilisatrice. Les ventes et les dépenses sont créées en brouillon : l’utilisatrice les vérifie et les valide elle-même dans YrelCompta. Les encaissements, factures et avoirs se gèrent uniquement dans l’application. Consultez d’abord les données existantes (matières, fournisseurs, catégories) pour éviter les doublons.";

/** Erreur destinée à l'utilisatrice : son message est renvoyé tel quel à Claude. */
export class McpToolError extends Error {}

export interface McpTool<Context> {
  name: string;
  /** « write » crée ou modifie des données : Claude demande alors l'accord de l'utilisatrice. */
  kind?: "read" | "write";
  title: string;
  description: string;
  input: z.ZodObject;
  run: (input: Record<string, unknown>, context: Context) => Promise<unknown>;
}

type JsonRpcId = string | number;
interface JsonRpcResponse { jsonrpc: "2.0"; id: JsonRpcId | null; result?: unknown; error?: { code: number; message: string } }

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function failure(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function toolDefinitions<Context>(tools: McpTool<Context>[]) {
  return tools.map((tool) => {
    const inputSchema = z.toJSONSchema(tool.input) as Record<string, unknown>;
    delete inputSchema.$schema;
    return { name: tool.name, title: tool.title, description: tool.description, inputSchema, annotations: { title: tool.title, readOnlyHint: tool.kind !== "write", destructiveHint: false, idempotentHint: tool.kind !== "write", openWorldHint: false } };
  });
}

async function handleRequest<Context>(id: JsonRpcId, method: string, params: Record<string, unknown>, tools: McpTool<Context>[], context: Context): Promise<JsonRpcResponse> {
  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
    return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS } };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: toolDefinitions(tools) } };
  if (method === "tools/call") {
    const tool = tools.find((candidate) => candidate.name === params.name);
    if (!tool) return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
    const parsed = tool.input.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `Paramètres invalides : ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "entrée"} ${issue.message}`).join(" ; ")}` }] } };
    }
    try {
      const output = await tool.run(parsed.data as Record<string, unknown>, context);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output) }] } };
    } catch (error) {
      if (error instanceof McpToolError) return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: error.message }] } };
      console.error("Outil du connecteur en échec", { tool: tool.name, code: error instanceof Error ? error.message : "UNKNOWN" });
      return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Les données de YrelCompta sont momentanément indisponibles. Réessayez plus tard." }] } };
    }
  }
  return failure(id, -32601, `Method not found: ${method}`);
}

/**
 * Traite un message (ou un lot) JSON-RPC reçu en POST.
 * Renvoie null lorsqu'il n'y a que des notifications ou des réponses : la route répond alors 202.
 */
export async function handleMcpMessage<Context>(body: unknown, tools: McpTool<Context>[], context: Context): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0) return failure(null, -32600, "Invalid Request");
  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) {
      // Réponse d'un client à une requête du serveur : rien à faire, ce serveur n'en émet pas.
      const isClientResponse = typeof message === "object" && message !== null && "id" in message && ("result" in message || "error" in message);
      if (!isClientResponse) responses.push(failure(null, -32600, "Invalid Request"));
      continue;
    }
    const { id, method, params } = parsed.data;
    if (id === undefined) continue; // notification (ex. notifications/initialized)
    responses.push(await handleRequest(id, method, params ?? {}, tools, context));
  }
  if (responses.length === 0) return null;
  return Array.isArray(body) ? responses : responses[0];
}
