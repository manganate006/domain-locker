/**
 * IONOS Registrar Provider
 *
 * Implémentation du provider pour l'API IONOS.
 * Utilise l'API DNS pour lister les zones (= domaines).
 * L'API Domains nécessite une activation spéciale.
 *
 * Documentation API IONOS :
 * - DNS API: https://developer.hosting.ionos.com/docs/dns
 * - Domains API: https://developer.hosting.ionos.com/docs/domains
 *
 * Authentification :
 * - Header X-API-Key avec format "prefix.secret"
 * - Création de clé API : https://developer.hosting.ionos.fr/docs/getstarted
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials spécifiques pour IONOS
 */
export interface IonosCredentials extends ProviderCredentials {
  apiKey: string;
}

/**
 * Réponse de l'API Domains IONOS pour /domains/v1/domainitems
 */
interface IonosDomainsListResponse {
  count: number;
  domains: {
    id: string;
    name: string;
    tld: string;
  }[];
}

/**
 * Détails d'un domaine IONOS
 */
interface IonosDomainDetail {
  id: string;
  name: string;
  tld: string;
  expirationDate?: string;
  autoRenew?: boolean;
  transferLock?: boolean;
  dnsSecEnabled?: boolean;
  domainType?: string;
}

/**
 * Provider IONOS pour l'import de domaines
 */
export class IonosProvider implements RegistrarProvider {
  readonly name = 'ionos';

  readonly config: ProviderConfig = {
    name: 'ionos',
    displayName: 'IONOS',
    description: 'Import domains from your IONOS account using API credentials',
    docsUrl: 'https://developer.hosting.ionos.fr/docs/getstarted',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'prefix.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        helpText: 'Your IONOS API Key (format: prefix.secret)',
        required: true,
      },
    ],
  };

  /**
   * Effectue une requête via le proxy backend pour contourner CORS
   */
  private async request<T>(
    credentials: IonosCredentials,
    method: string,
    path: string,
    body: string = ''
  ): Promise<T> {
    const response = await fetch('/api/registrar-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'ionos',
        method,
        path,
        body: body || undefined,
        credentials: {
          apiKey: credentials.apiKey,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Proxy error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.statusCode && result.statusCode >= 400) {
      throw new Error(`IONOS API error (${result.statusCode}): ${JSON.stringify(result.body)}`);
    }

    if (result.error) {
      throw new Error(`IONOS API error: ${JSON.stringify(result.data || result)}`);
    }

    return result.data as T;
  }

  /**
   * Vérifie si les credentials sont valides via l'API Domains
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const ionosCreds = credentials as IonosCredentials;
      await this.request<IonosDomainsListResponse>(ionosCreds, 'GET', '/domains/v1/domainitems');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines via l'API Domains
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const ionosCreds = credentials as IonosCredentials;
    const response = await this.request<IonosDomainsListResponse>(
      ionosCreds, 'GET', '/domains/v1/domainitems'
    );
    return response.domains.map((d) => d.name).filter(Boolean);
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const ionosCreds = credentials as IonosCredentials;
    // D'abord trouver l'ID du domaine
    const listResponse = await this.request<IonosDomainsListResponse>(
      ionosCreds, 'GET', '/domains/v1/domainitems'
    );
    const domainItem = listResponse.domains.find((d) => d.name === domain);

    if (!domainItem) {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'IONOS',
      };
    }

    // Récupérer les détails
    const detail = await this.request<IonosDomainDetail>(
      ionosCreds, 'GET', `/domains/v1/domainitems/${domainItem.id}`
    );

    return {
      domain_name: detail.name,
      expiry_date: detail.expirationDate ? new Date(detail.expirationDate) : null,
      registrar_name: 'IONOS',
    };
  }

  /**
   * Récupère les informations de tous les domaines via l'API Domains
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const ionosCreds = credentials as IonosCredentials;

    // 1. Récupérer la liste des domaines
    const listResponse = await this.request<IonosDomainsListResponse>(
      ionosCreds, 'GET', '/domains/v1/domainitems'
    );

    // 2. Récupérer les détails de chaque domaine
    const domains: DomainInfo[] = [];
    for (const d of listResponse.domains) {
      try {
        const detail = await this.request<IonosDomainDetail>(
          ionosCreds, 'GET', `/domains/v1/domainitems/${d.id}`
        );
        domains.push({
          domain_name: detail.name,
          expiry_date: detail.expirationDate ? new Date(detail.expirationDate) : null,
          registrar_name: 'IONOS',
        });
      } catch (error) {
        // Si erreur sur un domaine, continuer avec les autres
        console.error(`Failed to get details for domain ${d.name}:`, error);
        domains.push({
          domain_name: d.name,
          expiry_date: null,
          registrar_name: 'IONOS',
        });
      }
    }
    return domains;
  }
}

/**
 * Instance singleton du provider IONOS
 */
export const ionosProvider = new IonosProvider();
