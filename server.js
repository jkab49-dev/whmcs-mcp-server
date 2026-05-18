import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ─── Config ────────────────────────────────────────────────────────────────
const WHMCS_URL = (process.env.WHMCS_URL || "https://cloudstore.africa/ctadmin").replace(/\/$/, "");
const WHMCS_IDENTIFIER = process.env.WHMCS_IDENTIFIER;
const WHMCS_SECRET = process.env.WHMCS_SECRET;
const PORT = process.env.PORT || 3000;

if (!WHMCS_IDENTIFIER || !WHMCS_SECRET) {
  console.error("❌ Variables d'environnement manquantes : WHMCS_IDENTIFIER, WHMCS_SECRET");
  process.exit(1);
}

// ─── WHMCS API Helper ───────────────────────────────────────────────────────
async function callWHMCS(action, params = {}) {
  const body = new URLSearchParams({
    identifier: WHMCS_IDENTIFIER,
    secret: WHMCS_SECRET,
    action,
    responsetype: "json",
    ...Object.fromEntries(
      Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== "")
    ),
  });

  const res = await fetch(`${WHMCS_URL}/includes/api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`WHMCS HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  if (data.result === "error") {
    throw new Error(`WHMCS API Error: ${data.message}`);
  }

  return data;
}

// ─── MCP Server Factory ──────────────────────────────────────────────────────
function createMcpServer() {
  const server = new McpServer({
    name: "whmcs-cloudstore",
    version: "1.0.0",
  });

// ── Tool 1 : Lister les clients ─────────────────────────────────────────────
server.tool(
  "whmcs_get_clients",
  "Lister les clients CloudStore WHMCS avec filtre optionnel par nom, email ou entreprise.",
  {
    search: z.string().optional().describe("Terme de recherche : nom, email ou entreprise"),
    limitstart: z.number().optional().describe("Offset pagination (défaut : 0)"),
    limitnum: z.number().optional().describe("Nombre de résultats (défaut : 25, max : 250)"),
  },
  async ({ search, limitstart, limitnum }) => {
    const data = await callWHMCS("GetClients", {
      search,
      limitstart: limitstart ?? 0,
      limitnum: limitnum ?? 25,
    });

    const clients = data.clients?.client ?? [];
    if (clients.length === 0) {
      return { content: [{ type: "text", text: "Aucun client trouvé." }] };
    }

    const lines = clients.map((c) =>
      `[ID:${c.id}] ${c.firstname} ${c.lastname} | ${c.companyname || "—"} | ${c.email} | Statut: ${c.status}`
    );

    return {
      content: [
        {
          type: "text",
          text: `${data.totalresults} client(s) trouvé(s). Affichage de ${clients.length} :\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ── Tool 2 : Détail d'un client ─────────────────────────────────────────────
server.tool(
  "whmcs_get_client_details",
  "Obtenir les informations complètes d'un client WHMCS par son ID.",
  {
    clientid: z.number().describe("ID du client WHMCS"),
  },
  async ({ clientid }) => {
    const data = await callWHMCS("GetClientsDetails", { clientid, stats: true });

    const c = data.client;
    const s = data.stats || {};

    const info = [
      `👤 ${c.firstname} ${c.lastname} (ID: ${c.id})`,
      `🏢 Entreprise : ${c.companyname || "—"}`,
      `📧 Email : ${c.email}`,
      `📞 Tél : ${c.phonenumber || "—"}`,
      `📍 Pays : ${c.country}`,
      `🔖 Statut : ${c.status}`,
      `📅 Client depuis : ${c.datecreated}`,
      ``,
      `💰 Factures impayées : ${s.numoverinvoices ?? "—"} (${s.totaloverinvoices ?? "—"})`,
      `✅ Factures payées : ${s.numpaidinvoices ?? "—"} (${s.totalpaidinvoices ?? "—"})`,
      `📦 Services actifs : ${s.numactiveproducts ?? "—"}`,
      `🌐 Domaines actifs : ${s.numactivedomains ?? "—"}`,
    ].join("\n");

    return { content: [{ type: "text", text: info }] };
  }
);

// ── Tool 3 : Services / produits d'un client ────────────────────────────────
server.tool(
  "whmcs_get_client_services",
  "Lister les services actifs d'un client CloudStore (hébergement, cloud, VPS, etc.).",
  {
    clientid: z.number().describe("ID du client WHMCS"),
    status: z.enum(["Active", "Suspended", "Cancelled", "Terminated", "Pending"]).optional().describe("Filtrer par statut"),
  },
  async ({ clientid, status }) => {
    const data = await callWHMCS("GetClientsProducts", {
      clientid,
      status,
      limitnum: 100,
    });

    const products = data.products?.product ?? [];
    if (products.length === 0) {
      return { content: [{ type: "text", text: "Aucun service trouvé pour ce client." }] };
    }

    const lines = products.map((p) =>
      [
        `[ID:${p.id}] ${p.name}`,
        `  • Statut : ${p.status}`,
        `  • Domaine : ${p.domain || "—"}`,
        `  • Prochaine échéance : ${p.nextduedate}`,
        `  • Montant : ${p.amount} ${p.billingcycle}`,
      ].join("\n")
    );

    return {
      content: [
        {
          type: "text",
          text: `${products.length} service(s) trouvé(s) :\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// ── Tool 4 : Lister les factures ────────────────────────────────────────────
server.tool(
  "whmcs_get_invoices",
  "Lister les factures WHMCS avec filtres par client, statut ou période.",
  {
    clientid: z.number().optional().describe("Filtrer par ID client"),
    status: z.enum(["Unpaid", "Paid", "Cancelled", "Refunded", "Collections", "Payment Pending"]).optional().describe("Statut de la facture"),
    limitstart: z.number().optional().describe("Offset pagination"),
    limitnum: z.number().optional().describe("Nombre de résultats (défaut : 25)"),
  },
  async ({ clientid, status, limitstart, limitnum }) => {
    const data = await callWHMCS("GetInvoices", {
      clientid,
      status,
      limitstart: limitstart ?? 0,
      limitnum: limitnum ?? 25,
    });

    const invoices = data.invoices?.invoice ?? [];
    if (invoices.length === 0) {
      return { content: [{ type: "text", text: "Aucune facture trouvée." }] };
    }

    const lines = invoices.map((inv) =>
      `[#${inv.id}] Client:${inv.userid} | ${inv.date} → ${inv.duedate} | ${inv.total} | Statut: ${inv.status}`
    );

    return {
      content: [
        {
          type: "text",
          text: `${data.totalresults} facture(s). Affichage de ${invoices.length} :\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ── Tool 5 : Détail d'une facture ───────────────────────────────────────────
server.tool(
  "whmcs_get_invoice",
  "Obtenir le détail complet d'une facture WHMCS (lignes, montants, statut de paiement).",
  {
    invoiceid: z.number().describe("ID de la facture WHMCS"),
  },
  async ({ invoiceid }) => {
    const data = await callWHMCS("GetInvoice", { invoiceid });

    const items = (data.items?.item ?? [])
      .map((i) => `  • ${i.description} : ${i.amount}`)
      .join("\n");

    const info = [
      `🧾 Facture #${data.invoiceid}`,
      `👤 Client ID : ${data.userid}`,
      `📅 Date : ${data.date} | Échéance : ${data.duedate}`,
      `💰 Sous-total : ${data.subtotal} | TVA : ${data.tax} | Total : ${data.total}`,
      `✅ Statut : ${data.status}`,
      ``,
      `Lignes :`,
      items || "  (aucune ligne)",
    ].join("\n");

    return { content: [{ type: "text", text: info }] };
  }
);

// ── Tool 6 : Lister les commandes ───────────────────────────────────────────
server.tool(
  "whmcs_get_orders",
  "Lister les commandes WHMCS (nouveaux abonnements, upgrades, etc.).",
  {
    clientid: z.number().optional().describe("Filtrer par ID client"),
    status: z.enum(["Pending", "Active", "Fraud", "Cancelled"]).optional().describe("Statut de la commande"),
    limitstart: z.number().optional().describe("Offset pagination"),
    limitnum: z.number().optional().describe("Nombre de résultats (défaut : 25)"),
  },
  async ({ clientid, status, limitstart, limitnum }) => {
    const data = await callWHMCS("GetOrders", {
      clientid,
      status,
      limitstart: limitstart ?? 0,
      limitnum: limitnum ?? 25,
    });

    const orders = data.orders?.order ?? [];
    if (orders.length === 0) {
      return { content: [{ type: "text", text: "Aucune commande trouvée." }] };
    }

    const lines = orders.map((o) =>
      `[#${o.id}] Client:${o.userid} | ${o.date} | Total: ${o.amount} | Statut: ${o.status} | ${o.paymentmethod}`
    );

    return {
      content: [
        {
          type: "text",
          text: `${data.totalresults} commande(s). Affichage de ${orders.length} :\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

  return server;
}

// ─── Express + SSE Transport ─────────────────────────────────────────────────
const app = express();
app.use(express.json());
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  const server = createMcpServer();
  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(404).json({ error: "Session introuvable" });
  }
  await transport.handlePostMessage(req, res, req.body);
});

// ─── Streamable HTTP Transport (nouveau protocole MCP) ───────────────────────
app.all("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/health", (_, res) => {
  res.json({ status: "ok", server: "whmcs-cloudstore-mcp", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`✅ WHMCS MCP Server démarré sur le port ${PORT}`);
  console.log(`🔗 WHMCS URL : ${WHMCS_URL}`);
  console.log(`📡 SSE endpoint : http://localhost:${PORT}/sse`);
});
