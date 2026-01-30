/**
 * Cloudflare Registrar Provider
 *
 * Implémentation du provider pour l'API Cloudflare.
 * Utilise l'authentification par Email + API Key.
 *
 * Documentation API Cloudflare :
 * https://developers.cloudflare.com/api/
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials Cloudflare
 */
export interface CloudflareCredentials extends ProviderCredentials {
  email: string;
  apiKey: string;
  accountId: string;
}

/**
 * Base URL de l'API Cloudflare
 */
const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';

/**
 * Réponse zone Cloudflare
 */
interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  created_on: string;
  modified_on: string;
  name_servers: string[];
}

/**
 * Réponse domaine registrar Cloudflare
 */
interface CloudflareDomain {
  name: string;
  expires_at: string;
  auto_renew: boolean;
  locked: boolean;
  created_at?: string;
}

/**
 * Réponse API Cloudflare
 */
interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors: any[];
  messages: any[];
  result_info?: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
}

/**
 * Provider Cloudflare pour l'import de domaines
 */
export class CloudflareProvider implements RegistrarProvider {
  readonly name = 'cloudflare';

  readonly config: ProviderConfig = {
    name: 'cloudflare',
    displayName: 'Cloudflare',
    description: 'Import domains from your Cloudflare account',
    docsUrl: 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
    credentialFields: [
      {
        key: 'email',
        label: 'Email',
        type: 'email',
        placeholder: 'your-email@example.com',
        helpText: 'The email associated with your Cloudflare account',
        required: true,
      },
      {
        key: 'apiKey',
        label: 'Global API Key',
        type: 'password',
        placeholder: 'Your Cloudflare Global API Key',
        helpText: 'Find it in My Profile → API Tokens → Global API Key',
        required: true,
      },
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        placeholder: 'Your Cloudflare Account ID',
        helpText: 'Find it in any domain overview page, right sidebar',
        required: true,
      },
    ],
  };

  /**
   * Effectue une requête authentifiée vers l'API Cloudflare
   */
  private async request<T>(
    credentials: CloudflareCredentials,
    method: string,
    path: string
  ): Promise<CloudflareResponse<T>> {
    const url = `${CLOUDFLARE_API_URL}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Auth-Email': credentials.email,
      'X-Auth-Key': credentials.apiKey,
    };

    const response = await fetch(url, {
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
    }

    return data;
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as CloudflareCredentials;
      await this.request<CloudflareZone[]>(creds, 'GET', '/zones?per_page=1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère toutes les zones avec pagination
   */
  private async fetchAllZones(credentials: CloudflareCredentials): Promise<CloudflareZone[]> {
    const allZones: CloudflareZone[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<CloudflareZone[]>(
        credentials,
        'GET',
        `/zones?status=active&account.id=${credentials.accountId}&per_page=50&page=${page}`
      );

      allZones.push(...response.result);

      if (response.result_info) {
        hasMore = page < response.result_info.total_pages;
        page++;
      } else {
        hasMore = false;
      }

      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return allZones;
  }

  /**
   * Récupère la liste des domaines (zones)
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as CloudflareCredentials;
    const zones = await this.fetchAllZones(creds);
    return zones.map((z) => z.name);
  }

  /**
   * Récupère les informations registrar d'un domaine
   */
  private async getRegistrarInfo(
    credentials: CloudflareCredentials,
    domain: string
  ): Promise<CloudflareDomain | null> {
    try {
      const response = await this.request<CloudflareDomain>(
        credentials,
        'GET',
        `/accounts/${credentials.accountId}/registrar/domains/${domain}`
      );
      return response.result;
    } catch {
      return null;
    }
  }

  /**
   * Convertit une zone Cloudflare en DomainInfo
   */
  private toDomainInfo(zone: CloudflareZone, registrarInfo?: CloudflareDomain | null): DomainInfo {
    return {
      domain_name: zone.name,
      expiry_date: registrarInfo?.expires_at ? new Date(registrarInfo.expires_at) : null,
      registration_date: zone.created_on ? new Date(zone.created_on) : null,
      dns_servers: zone.name_servers || [],
      auto_renew: registrarInfo?.auto_renew,
      status: zone.status,
      registrar_name: 'Cloudflare',
    };
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const creds = credentials as CloudflareCredentials;

    try {
      // Récupérer la zone
      const zonesResponse = await this.request<CloudflareZone[]>(
        creds,
        'GET',
        `/zones?name=${encodeURIComponent(domain)}`
      );

      if (zonesResponse.result.length === 0) {
        return {
          domain_name: domain,
          expiry_date: null,
          registrar_name: 'Cloudflare',
        };
      }

      const zone = zonesResponse.result[0];

      // Essayer de récupérer les infos registrar
      const registrarInfo = await this.getRegistrarInfo(creds, domain);

      return this.toDomainInfo(zone, registrarInfo);
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'Cloudflare',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as CloudflareCredentials;
    const zones = await this.fetchAllZones(creds);

    const domainsInfo: DomainInfo[] = [];

    for (const zone of zones) {
      const registrarInfo = await this.getRegistrarInfo(creds, zone.name);
      domainsInfo.push(this.toDomainInfo(zone, registrarInfo));

      // Pause pour respecter les rate limits
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return domainsInfo;
  }
}

/**
 * Instance singleton du provider Cloudflare
 */
export const cloudflareProvider = new CloudflareProvider();
