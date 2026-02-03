/**
 * Registrar Autofetch Endpoint
 *
 * Endpoint appelé par cron pour synchroniser automatiquement
 * les domaines depuis les comptes registrars configurés avec auto_sync=true.
 *
 * Sécurisé par une clé API stockée en base de données.
 *
 * Usage cron:
 * curl -X POST http://localhost:3000/api/registrar-autofetch?key=YOUR_API_KEY
 */

import { defineEventHandler, getQuery } from 'h3';

const DOMAIN_IMPORT_DELAY = 100; // ms between domains

// Provider display names pour les notes d'import
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  ovh: 'OVH',
  hostinger: 'Hostinger',
  godaddy: 'GoDaddy',
  cloudflare: 'Cloudflare',
  namecheap: 'Namecheap',
  namesilo: 'NameSilo',
  gandi: 'Gandi',
  porkbun: 'Porkbun',
  namecom: 'Name.com',
  dynadot: 'Dynadot',
  dreamhost: 'DreamHost',
  enom: 'eNom',
  internetbs: 'Internet.bs',
  namebright: 'NameBright',
  opensrs: 'OpenSRS',
  resellerclub: 'ResellerClub',
  dnsimple: 'DNSimple',
  abovecom: 'Above.com',
};

/**
 * Helpers pour les variables d'environnement
 */
function getEnvVar(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

/**
 * Appelle le pg-executor pour exécuter une requête SQL
 */
async function callPgExecutor<T = any>(
  baseUrl: string,
  query: string,
  params: any[] = []
): Promise<T[]> {
  const response = await fetch(`${baseUrl}/api/pg-executer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PG Executor error: ${error}`);
  }

  const result = await response.json();
  return result.data || [];
}

/**
 * Vérifie la clé API
 */
async function validateApiKey(baseUrl: string, providedKey: string): Promise<boolean> {
  if (!providedKey) return false;

  const rows = await callPgExecutor<{ api_key: string }>(
    baseUrl,
    'SELECT api_key FROM autofetch_settings LIMIT 1'
  );

  if (rows.length === 0) return false;
  return rows[0].api_key === providedKey;
}

/**
 * Récupère les comptes avec auto_sync activé
 */
async function getAutoSyncAccounts(baseUrl: string): Promise<{
  id: string;
  provider_name: string;
  label: string | null;
  credentials: any;
}[]> {
  return callPgExecutor(
    baseUrl,
    `SELECT id, provider_name, label, credentials
     FROM registrar_accounts
     WHERE auto_sync = true
     ORDER BY provider_name`
  );
}

/**
 * Met à jour last_sync_at pour un compte
 */
async function updateLastSyncAt(baseUrl: string, accountId: string): Promise<void> {
  await callPgExecutor(
    baseUrl,
    `UPDATE registrar_accounts
     SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [accountId]
  );
}

/**
 * Vérifie si un domaine existe déjà
 */
async function domainExists(baseUrl: string, domainName: string): Promise<boolean> {
  const rows = await callPgExecutor<{ count: number }>(
    baseUrl,
    `SELECT COUNT(*) as count FROM domains WHERE LOWER(domain_name) = LOWER($1)`,
    [domainName]
  );
  return rows.length > 0 && Number(rows[0].count) > 0;
}

/**
 * Récupère ou crée un registrar
 */
async function getOrCreateRegistrar(
  baseUrl: string,
  registrarName: string
): Promise<string> {
  // Chercher s'il existe
  const existing = await callPgExecutor<{ id: string }>(
    baseUrl,
    `SELECT id FROM registrars WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [registrarName]
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Créer le registrar
  const created = await callPgExecutor<{ id: string }>(
    baseUrl,
    `INSERT INTO registrars (name, url)
     VALUES ($1, $2)
     RETURNING id`,
    [registrarName, '']
  );

  return created[0]?.id || '';
}

/**
 * Importe un domaine dans la base de données
 */
async function importDomain(
  baseUrl: string,
  domainInfo: {
    domain_name: string;
    expiry_date: Date | null;
    registration_date?: Date | null;
    registrar_name: string;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    // Vérifier si le domaine existe déjà
    if (await domainExists(baseUrl, domainInfo.domain_name)) {
      return { success: false, message: 'Domain already exists' };
    }

    // Récupérer ou créer le registrar
    const registrarId = await getOrCreateRegistrar(baseUrl, domainInfo.registrar_name);

    // Insérer le domaine
    await callPgExecutor(
      baseUrl,
      `INSERT INTO domains (domain_name, expiry_date, registration_date, registrar_id, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        domainInfo.domain_name,
        domainInfo.expiry_date,
        domainInfo.registration_date || null,
        registrarId || null,
        `Auto-imported from ${domainInfo.registrar_name}`,
      ]
    );

    return { success: true, message: 'Imported successfully' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Import failed' };
  }
}

/**
 * Appelle le proxy registrar pour récupérer les domaines
 */
async function fetchDomainsViaProxy(
  baseUrl: string,
  providerName: string,
  credentials: any
): Promise<{ domain_name: string; expiry_date: Date | null; registration_date?: Date | null }[]> {
  const domains: { domain_name: string; expiry_date: Date | null; registration_date?: Date | null }[] = [];

  // Configuration selon le provider
  switch (providerName.toLowerCase()) {
    case 'ovh': {
      // Récupérer la liste des domaines
      const listResponse = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'ovh',
          credentials,
          method: 'GET',
          path: '/domain',
        }),
      });
      const listResult = await listResponse.json();
      if (!listResult.success || !Array.isArray(listResult.data)) {
        throw new Error(listResult.data?.message || 'Failed to fetch OVH domain list');
      }

      // Récupérer les infos de chaque domaine
      for (const domainName of listResult.data) {
        try {
          const infoResponse = await fetch(`${baseUrl}/api/registrar-proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: 'ovh',
              credentials,
              method: 'GET',
              path: `/domain/${domainName}/serviceInfos`,
            }),
          });
          const infoResult = await infoResponse.json();
          if (infoResult.success && infoResult.data) {
            domains.push({
              domain_name: domainName,
              expiry_date: infoResult.data.expiration ? new Date(infoResult.data.expiration) : null,
              registration_date: infoResult.data.creation ? new Date(infoResult.data.creation) : null,
            });
          }
        } catch {
          // Ignorer les erreurs individuelles, continuer avec les autres domaines
          domains.push({ domain_name: domainName, expiry_date: null });
        }
      }
      break;
    }

    case 'hostinger': {
      const response = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'hostinger',
          credentials,
          method: 'GET',
          path: '/domains/v1/portfolio',
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.data?.message || 'Failed to fetch Hostinger domains');
      }
      // Hostinger peut retourner un tableau direct ou { data: [...] }
      const domainsArray = Array.isArray(result.data) ? result.data :
                           Array.isArray(result.data?.data) ? result.data.data : [];
      for (const d of domainsArray) {
        domains.push({
          domain_name: d.domain || d.domain_name,
          expiry_date: d.expiration_date ? new Date(d.expiration_date) : null,
          registration_date: d.registration_date ? new Date(d.registration_date) : null,
        });
      }
      break;
    }

    case 'godaddy': {
      const response = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'godaddy',
          credentials,
          method: 'GET',
          path: '/domains',
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.data?.message || 'Failed to fetch GoDaddy domains');
      }
      const domainsArray = Array.isArray(result.data) ? result.data : [];
      for (const d of domainsArray) {
        domains.push({
          domain_name: d.domain,
          expiry_date: d.expires ? new Date(d.expires) : null,
          registration_date: d.createdAt ? new Date(d.createdAt) : null,
        });
      }
      break;
    }

    case 'cloudflare': {
      // Cloudflare utilise /zones pour lister les domaines
      const response = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'cloudflare',
          credentials,
          method: 'GET',
          path: '/zones',
        }),
      });
      const result = await response.json();
      if (!result.success || !result.data?.result) {
        throw new Error('Failed to fetch Cloudflare zones');
      }
      for (const zone of result.data.result) {
        domains.push({
          domain_name: zone.name,
          expiry_date: null, // Cloudflare ne gère pas l'expiration
          registration_date: zone.created_on ? new Date(zone.created_on) : null,
        });
      }
      break;
    }

    case 'gandi': {
      const response = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gandi',
          credentials,
          method: 'GET',
          path: '/domain/domains',
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.data?.message || 'Failed to fetch Gandi domains');
      }
      const domainsArray = Array.isArray(result.data) ? result.data : [];
      for (const d of domainsArray) {
        domains.push({
          domain_name: d.fqdn || d.domain,
          expiry_date: d.dates?.registry_ends_at ? new Date(d.dates.registry_ends_at) : null,
          registration_date: d.dates?.created_at ? new Date(d.dates.created_at) : null,
        });
      }
      break;
    }

    case 'porkbun': {
      const response = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'porkbun',
          credentials,
          method: 'POST',
          path: '/domain/listAll',
        }),
      });
      const result = await response.json();
      if (!result.success || result.data?.status !== 'SUCCESS') {
        throw new Error(result.data?.message || 'Failed to fetch Porkbun domains');
      }
      const domainsArray = result.data?.domains || [];
      for (const d of domainsArray) {
        domains.push({
          domain_name: d.domain,
          expiry_date: d.expireDate ? new Date(d.expireDate) : null,
          registration_date: d.createDate ? new Date(d.createDate) : null,
        });
      }
      break;
    }

    case 'namecom': {
      const response = await fetch(`${baseUrl}/api/registrar-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'namecom',
          credentials,
          method: 'GET',
          path: '/domains',
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.data?.message || 'Failed to fetch Name.com domains');
      }
      const domainsArray = result.data?.domains || [];
      for (const d of domainsArray) {
        domains.push({
          domain_name: d.domainName,
          expiry_date: d.expireDate ? new Date(d.expireDate) : null,
          registration_date: d.createDate ? new Date(d.createDate) : null,
        });
      }
      break;
    }

    default:
      throw new Error(`Provider "${providerName}" is not supported for autofetch`);
  }

  return domains;
}

/**
 * Synchronise les domaines d'un compte registrar
 */
async function syncAccount(
  baseUrl: string,
  account: {
    id: string;
    provider_name: string;
    label: string | null;
    credentials: any;
  }
): Promise<{
  account_id: string;
  provider: string;
  label: string | null;
  domains_found: number;
  imported: number;
  skipped: number;
  errors: number;
  details: { domain: string; status: string; message: string }[];
}> {
  const result = {
    account_id: account.id,
    provider: account.provider_name,
    label: account.label,
    domains_found: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    details: [] as { domain: string; status: string; message: string }[],
  };

  try {
    // Récupérer les domaines via le proxy
    const domains = await fetchDomainsViaProxy(baseUrl, account.provider_name, account.credentials);
    result.domains_found = domains.length;

    const registrarName = PROVIDER_DISPLAY_NAMES[account.provider_name.toLowerCase()] || account.provider_name.toUpperCase();

    // Importer chaque domaine
    for (const domain of domains) {
      const importResult = await importDomain(baseUrl, {
        domain_name: domain.domain_name,
        expiry_date: domain.expiry_date,
        registration_date: domain.registration_date,
        registrar_name: registrarName,
      });

      if (importResult.success) {
        result.imported++;
        result.details.push({
          domain: domain.domain_name,
          status: 'imported',
          message: importResult.message,
        });
      } else if (importResult.message === 'Domain already exists') {
        result.skipped++;
        result.details.push({
          domain: domain.domain_name,
          status: 'skipped',
          message: importResult.message,
        });
      } else {
        result.errors++;
        result.details.push({
          domain: domain.domain_name,
          status: 'error',
          message: importResult.message,
        });
      }

      // Pause entre les imports
      await new Promise((resolve) => setTimeout(resolve, DOMAIN_IMPORT_DELAY));
    }

    // Mettre à jour last_sync_at
    await updateLastSyncAt(baseUrl, account.id);

  } catch (error: any) {
    result.errors++;
    result.details.push({
      domain: '-',
      status: 'error',
      message: error.message || 'Sync failed',
    });
  }

  return result;
}

/**
 * Handler principal
 */
export default defineEventHandler(async (event) => {
  // Vérifier le mode self-hosted
  if (getEnvVar('DL_ENV_TYPE') !== 'selfHosted') {
    return {
      success: false,
      error: 'Only available in self-hosted mode',
    };
  }

  const baseUrl = getEnvVar('DL_BASE_URL', 'http://localhost:3000');

  // Vérifier la clé API
  const query = getQuery(event);
  const apiKey = (query.key as string) || '';

  if (!await validateApiKey(baseUrl, apiKey)) {
    return {
      success: false,
      error: 'Invalid or missing API key. Use ?key=YOUR_API_KEY',
    };
  }

  // Récupérer les comptes avec auto_sync activé
  const accounts = await getAutoSyncAccounts(baseUrl);

  if (accounts.length === 0) {
    return {
      success: true,
      message: 'No accounts with auto_sync enabled',
      accounts_processed: 0,
      total_imported: 0,
      total_skipped: 0,
      total_errors: 0,
    };
  }

  // Synchroniser chaque compte
  const results = [];
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const account of accounts) {
    const accountResult = await syncAccount(baseUrl, account);
    results.push(accountResult);
    totalImported += accountResult.imported;
    totalSkipped += accountResult.skipped;
    totalErrors += accountResult.errors;
  }

  return {
    success: true,
    message: `Autofetch completed for ${accounts.length} account(s)`,
    accounts_processed: accounts.length,
    total_imported: totalImported,
    total_skipped: totalSkipped,
    total_errors: totalErrors,
    results,
  };
});
