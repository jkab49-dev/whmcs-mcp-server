# WHMCS MCP Server — CloudStore Africa

Serveur MCP pour connecter Claude à WHMCS CloudStore.

## Outils exposés

| Tool | Description |
|------|-------------|
| `whmcs_get_clients` | Lister / rechercher les clients |
| `whmcs_get_client_details` | Détail complet d'un client + stats |
| `whmcs_get_client_services` | Services actifs d'un client |
| `whmcs_get_invoices` | Lister les factures (filtrables) |
| `whmcs_get_invoice` | Détail d'une facture |
| `whmcs_get_orders` | Lister les commandes |

## Déploiement Railway

1. Push ce repo sur GitHub
2. Créer un nouveau projet Railway → Deploy from GitHub
3. Ajouter les variables d'environnement :
   - `WHMCS_URL` = `https://cloudstore.africa/ctadmin`
   - `WHMCS_IDENTIFIER` = ton identifier
   - `WHMCS_SECRET` = ton secret
4. Railway expose automatiquement un domaine public

## Connexion à Claude

Dans Claude.ai → Settings → Connectors → Add MCP Server :
```
URL : https://ton-projet.railway.app/sse
```
