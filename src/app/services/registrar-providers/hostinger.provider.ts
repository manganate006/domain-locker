/**
 * Hostinger Registrar Provider
 *
 * Implémentation du provider pour l'API Hostinger.
 * Utilise l'authentification Bearer Token.
 * Les requêtes passent par le proxy backend pour contourner CORS.
 *
 * Basé sur le pattern de la PR #182 de DomainMOD :
 * https://github.com/domainmod/domainmod/pull/182
 *
 * Documentation API Hostinger :
 * https://developers.hostinger.com/
 */

import {
  RegistrarProvider,
  ProviderConfig,
  HostingerCredentials,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

/**
 * Réponse de l'API Hostinger pour la liste des domaines
 */
interface HostingerDomain {
  id: number;
  domain: string;
  status: string;
  expires_at: string | null;
  created_at: string | null;
  auto_renew: boolean;
  locked: boolean;
  nameservers?: string[];
}

/**
 * Réponse paginée de l'API Hostinger
 */
interface HostingerDomainsResponse {
  data: HostingerDomain[];
  meta?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

/**
 * Provider Hostinger pour l'import de domaines
 */
export class HostingerProvider implements RegistrarProvider {
  readonly name = 'hostinger';

  readonly config: ProviderConfig = {
    name: 'hostinger',
    displayName: 'Hostinger',
    description: 'Import domains from your Hostinger account using API key',
    docsUrl: 'https://developers.hostinger.com/',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your Hostinger API key',
        helpText: 'Generate an API key from your Hostinger dashboard under API section',
        required: true,
      },
    ],
  };

  /**
   * Effectue une requête authentifiée vers l'API Hostinger via le proxy backend
   */
  private async request<T>(
    credentials: HostingerCredentials,
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    // Utiliser le proxy backend pour contourner CORS
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'hostinger',
        credentials: {
          apiKey: credentials.apiKey,
        },
        request: {
          method,
          path,
          body: body ? JSON.stringify(body) : '',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hostinger API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Le proxy retourne { success, data } ou { statusCode, body: { error, data } }
    if (result.error || result.statusCode >= 400) {
      const errorData = result.body?.data || result.data || 'Unknown error';
      const errorMsg = typeof errorData === 'string' && errorData.includes('<!DOCTYPE')
        ? 'Hostinger API is temporarily unavailable (DNS error)'
        : JSON.stringify(errorData);
      throw new Error(`Hostinger API error: ${errorMsg}`);
    }

    if (!result.data) {
      throw new Error('Hostinger API error: Empty response from proxy');
    }

    return result.data as T;
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const hostingerCreds = credentials as HostingerCredentials;
      // Tenter de récupérer la liste des domaines comme test
      // Endpoint officiel : /domains/v1/portfolio
      await this.request<HostingerDomainsResponse>(hostingerCreds, 'GET', '/domains/v1/portfolio');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère tous les domaines avec pagination
   * Endpoint officiel : GET /api/domains/v1/portfolio
   */
  private async fetchAllDomains(credentials: HostingerCredentials): Promise<HostingerDomain[]> {
    const allDomains: HostingerDomain[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<HostingerDomainsResponse | HostingerDomain[]>(
        credentials,
        'GET',
        `/domains/v1/portfolio?page=${page}&per_page=100`
      );

      // L'API peut retourner soit { data: [...], meta: {...} } soit directement [...]
      const domainsArray = Array.isArray(response)
        ? response
        : Array.isArray(response.data)
          ? response.data
          : [];

      if (domainsArray.length === 0 && page === 1) {
        console.warn('[Hostinger] No domains array found in response:', JSON.stringify(response).slice(0, 200));
      }

      allDomains.push(...domainsArray);

      // Gestion de la pagination - uniquement si response est un objet avec meta
      const meta = !Array.isArray(response) ? response.meta : undefined;
      if (meta) {
        hasMore = page < meta.last_page;
        page++;
      } else {
        hasMore = false;
      }

      // Pause entre les pages pour respecter les rate limits
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Filtrer les domaines sans nom (pending_setup sans domain défini)
    return allDomains.filter((d) => d.domain && d.domain.trim() !== '');
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const hostingerCreds = credentials as HostingerCredentials;
    const domains = await this.fetchAllDomains(hostingerCreds);
    return domains.map((d) => d.domain);
  }

  /**
   * Convertit un domaine Hostinger en DomainInfo
   */
  private toDomainInfo(domain: HostingerDomain): DomainInfo {
    return {
      domain_name: domain.domain,
      expiry_date: domain.expires_at ? new Date(domain.expires_at) : null,
      registration_date: domain.created_at ? new Date(domain.created_at) : null,
      dns_servers: domain.nameservers || [],
      auto_renew: domain.auto_renew,
      status: domain.status,
      registrar_name: 'Hostinger',
    };
  }

  /**
   * Récupère les informations détaillées d'un domaine
   * Endpoint officiel : GET /api/domains/v1/portfolio/{domain}
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const hostingerCreds = credentials as HostingerCredentials;

    try {
      // L'API Hostinger utilise le nom de domaine dans l'URL
      const response = await this.request<{ data: HostingerDomain }>(
        hostingerCreds,
        'GET',
        `/domains/v1/portfolio/${encodeURIComponent(domain)}`
      );

      return this.toDomainInfo(response.data);
    } catch (error) {
      // Fallback : chercher dans la liste complète
      try {
        const allDomains = await this.fetchAllDomains(hostingerCreds);
        const found = allDomains.find((d) => d.domain === domain);
        if (found) {
          return this.toDomainInfo(found);
        }
      } catch {
        // Ignorer l'erreur du fallback
      }

      // Retourner les infos minimales en cas d'erreur
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'Hostinger',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const hostingerCreds = credentials as HostingerCredentials;
    const domains = await this.fetchAllDomains(hostingerCreds);
    return domains.map((d) => this.toDomainInfo(d));
  }
}

/**
 * Instance singleton du provider Hostinger
 */
export const hostingerProvider = new HostingerProvider();
