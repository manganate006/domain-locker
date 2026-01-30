/**
 * Gandi Registrar Provider
 *
 * Implémentation du provider pour l'API Gandi.
 * Utilise l'authentification par API Key.
 *
 * Documentation API Gandi :
 * https://api.gandi.net/docs/
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials Gandi
 */
export interface GandiCredentials extends ProviderCredentials {
  apiKey: string;
}

/**
 * Base URL de l'API Gandi
 */
const GANDI_API_URL = 'https://api.gandi.net/v5';

/**
 * Réponse domaine Gandi
 */
interface GandiDomain {
  fqdn: string;
  fqdn_unicode: string;
  status: string[];
  dates: {
    created_at: string;
    registry_created_at: string;
    registry_ends_at: string;
    updated_at: string;
  };
  autorenew: {
    enabled: boolean;
  };
  nameservers: string[];
  tags: string[];
}

/**
 * Provider Gandi pour l'import de domaines
 */
export class GandiProvider implements RegistrarProvider {
  readonly name = 'gandi';

  readonly config: ProviderConfig = {
    name: 'gandi',
    displayName: 'Gandi',
    description: 'Import domains from your Gandi account using API key',
    docsUrl: 'https://api.gandi.net/docs/authentication/',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your Gandi API Key',
        helpText: 'Generate a Production API Key from Account → Security',
        required: true,
      },
    ],
  };

  /**
   * Effectue une requête authentifiée vers l'API Gandi
   */
  private async request<T>(
    credentials: GandiCredentials,
    method: string,
    path: string
  ): Promise<T> {
    const url = `${GANDI_API_URL}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Apikey ${credentials.apiKey}`,
    };

    const response = await fetch(url, {
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gandi API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as GandiCredentials;
      await this.request<GandiDomain[]>(creds, 'GET', '/domain/domains?per_page=1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère tous les domaines avec pagination
   */
  private async fetchAllDomains(credentials: GandiCredentials): Promise<GandiDomain[]> {
    const allDomains: GandiDomain[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const domains = await this.request<GandiDomain[]>(
        credentials,
        'GET',
        `/domain/domains?per_page=${perPage}&page=${page}`
      );

      allDomains.push(...domains);
      hasMore = domains.length === perPage;
      page++;

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
    const creds = credentials as GandiCredentials;
    const domains = await this.fetchAllDomains(creds);
    return domains.map((d) => d.fqdn);
  }

  /**
   * Convertit un domaine Gandi en DomainInfo
   */
  private toDomainInfo(domain: GandiDomain): DomainInfo {
    return {
      domain_name: domain.fqdn,
      expiry_date: domain.dates?.registry_ends_at ? new Date(domain.dates.registry_ends_at) : null,
      registration_date: domain.dates?.registry_created_at
        ? new Date(domain.dates.registry_created_at)
        : null,
      dns_servers: domain.nameservers || [],
      auto_renew: domain.autorenew?.enabled,
      status: domain.status?.join(', '),
      registrar_name: 'Gandi',
    };
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const creds = credentials as GandiCredentials;

    try {
      const domainInfo = await this.request<GandiDomain>(
        creds,
        'GET',
        `/domain/domains/${encodeURIComponent(domain)}`
      );
      return this.toDomainInfo(domainInfo);
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'Gandi',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as GandiCredentials;
    const domains = await this.fetchAllDomains(creds);
    return domains.map((d) => this.toDomainInfo(d));
  }
}

/**
 * Instance singleton du provider Gandi
 */
export const gandiProvider = new GandiProvider();
