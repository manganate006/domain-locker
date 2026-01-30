/**
 * Hostinger Registrar Provider
 *
 * Implémentation du provider pour l'API Hostinger.
 * Utilise l'authentification Bearer Token.
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
 * Base URL de l'API Hostinger
 */
const HOSTINGER_API_URL = 'https://api.hostinger.com/v1';

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
   * Effectue une requête authentifiée vers l'API Hostinger
   */
  private async request<T>(
    credentials: HostingerCredentials,
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    const url = `${HOSTINGER_API_URL}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${credentials.apiKey}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hostinger API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const hostingerCreds = credentials as HostingerCredentials;
      // Tenter de récupérer la liste des domaines comme test
      await this.request<HostingerDomainsResponse>(hostingerCreds, 'GET', '/domains');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère tous les domaines avec pagination
   */
  private async fetchAllDomains(credentials: HostingerCredentials): Promise<HostingerDomain[]> {
    const allDomains: HostingerDomain[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<HostingerDomainsResponse>(
        credentials,
        'GET',
        `/domains?page=${page}&per_page=100`
      );

      allDomains.push(...response.data);

      if (response.meta) {
        hasMore = page < response.meta.last_page;
        page++;
      } else {
        hasMore = false;
      }

      // Pause entre les pages pour respecter les rate limits
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return allDomains;
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
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const hostingerCreds = credentials as HostingerCredentials;

    try {
      // L'API Hostinger utilise le nom de domaine dans l'URL
      const response = await this.request<{ data: HostingerDomain }>(
        hostingerCreds,
        'GET',
        `/domains/${encodeURIComponent(domain)}`
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
