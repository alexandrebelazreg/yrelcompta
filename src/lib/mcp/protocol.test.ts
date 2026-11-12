import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleMcpMessage, McpToolError, SERVER_INFO, toolDefinitions, type McpTool } from "./protocol";

const run = vi.fn(async (input: Record<string, unknown>, context: { businessId: string }) => ({ entreprise: context.businessId, recherche: input.search ?? null }));
const tools: McpTool<{ businessId: string }>[] = [
  { name: "list_things", title: "Choses", description: "Liste des choses.", input: z.object({ search: z.string().max(5).optional() }), run },
  { name: "broken", title: "Cassé", description: "Échoue.", input: z.object({}), run: async () => { throw new Error("SECRET_DETAIL"); } },
  { name: "save_thing", kind: "write", title: "Enregistrer", description: "Écrit.", input: z.object({}), run: async () => { throw new McpToolError("Ce nom existe déjà."); } },
];
const context = { businessId: "biz-1" };
const call = (body: unknown) => handleMcpMessage(body, tools, context);

describe("protocole MCP", () => {
  it("répond à initialize avec la version demandée si elle est prise en charge", async () => {
    const response = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude" } } });
    expect(response).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } });
  });

  it("propose la version la plus récente quand la version demandée est inconnue", async () => {
    const response = await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(response).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("ignore les notifications et les réponses du client", async () => {
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await call({ jsonrpc: "2.0", id: 9, result: {} })).toBeNull();
  });

  it("liste les outils avec un schéma JSON objet et l’annotation lecture seule", async () => {
    const response = await call({ jsonrpc: "2.0", id: 3, method: "tools/list" }) as { result: { tools: Array<Record<string, unknown>> } };
    const [first] = response.result.tools;
    expect(first).toMatchObject({ name: "list_things", inputSchema: { type: "object", properties: { search: { type: "string", maxLength: 5 } } }, annotations: { readOnlyHint: true, destructiveHint: false } });
    expect(first.inputSchema).not.toHaveProperty("$schema");
  });

  it("exécute un outil avec le contexte de l’entreprise authentifiée", async () => {
    const response = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_things", arguments: { search: "perle" } } });
    expect(response).toMatchObject({ result: { content: [{ type: "text", text: JSON.stringify({ entreprise: "biz-1", recherche: "perle" }) }] } });
  });

  it("signale des paramètres invalides sans exécuter l’outil", async () => {
    run.mockClear();
    const response = await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_things", arguments: { search: "beaucoup trop long" } } });
    expect(response).toMatchObject({ result: { isError: true } });
    expect(run).not.toHaveBeenCalled();
  });

  it("masque le détail technique d’un outil en échec", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "broken" } }) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).not.toContain("SECRET_DETAIL");
  });

  it("annonce les outils d’écriture comme non lecture seule", () => {
    expect(toolDefinitions(tools).find((tool) => tool.name === "save_thing")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it("transmet tel quel un message d’erreur destiné à l’utilisatrice", async () => {
    expect(await call({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "save_thing" } })).toMatchObject({ result: { isError: true, content: [{ text: "Ce nom existe déjà." }] } });
  });

  it("décrit les champs transformés par Zod avec le type envoyé par Claude", async () => {
    const transformed: McpTool<{ businessId: string }> = { name: "with_amount", title: "Montant", description: "Champ transformé.", input: z.object({ amount: z.union([z.string(), z.number()]).transform(String) }), run };
    const response = await handleMcpMessage({ jsonrpc: "2.0", id: 11, method: "tools/list" }, [transformed], context) as { result: { tools: Array<{ inputSchema: { properties: { amount: { anyOf: unknown[] } } } }> } };
    expect(response.result.tools[0].inputSchema.properties.amount.anyOf).toEqual([{ type: "string" }, { type: "number" }]);
  });

  it("répond par une erreur JSON-RPC, jamais par une exception, quand une requête échoue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { name: "x", title: "x", description: "x", input: { safeParse: () => { throw new Error("boom"); } } } as unknown as McpTool<{ businessId: string }>;
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "x" } }, [broken], context)).toMatchObject({ id: 12, error: { code: -32603 } });
  });

  it("renvoie les erreurs JSON-RPC standard", async () => {
    expect(await call({ jsonrpc: "2.0", id: 7, method: "resources/list" })).toMatchObject({ error: { code: -32601 } });
    expect(await call({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "inconnu" } })).toMatchObject({ error: { code: -32602 } });
    expect(await call({ nope: true })).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await call([])).toMatchObject({ error: { code: -32600 } });
  });

  it("traite un lot de messages et ne répond qu’aux requêtes", async () => {
    const response = await call([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(response).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });

  it("génère des définitions sans dépendre du serveur", () => {
    expect(toolDefinitions(tools).map((tool) => tool.name)).toEqual(["list_things", "broken", "save_thing"]);
  });
});
