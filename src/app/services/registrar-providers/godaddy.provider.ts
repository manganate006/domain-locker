/**
 * GoDaddy Registrar Provider
 *
 * Implémentation du provider pour l'API GoDaddy.
 * Utilise l'authentification SSO-Key (API Key + Secret).
 *
 * Documentation API GoDaddy :
 * https://developer.godaddy.com/doc
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials GoDaddy
 */
export interface GoDaddyCredentials extends ProviderCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * Base URL de l'API GoDaddy
 */
const GODADDY_API_URL = 'https://api.godaddy.com/v1';

/**
 * Réponse de l'API GoDaddy pour un domaine
 */
interface GoDaddyDomain {
  domain: string;
  status: string;
  expires: string;
  expirationProtected: boolean;
  holdRegistrar: boolean;
  locked: boolean;
  privacy: boolean;
  renewAuto: boolean;
  renewable: boolean;
  transferProtected: boolean;
  createdAt?: string;
  nameServers?: string[];
}

/**
 * Provider GoDaddy pour l'import de domaines
 */
export class GoDaddyProvider implements RegistrarProvider {
  readonly name = 'godaddy';

  readonly config: ProviderConfig = {
    name: 'godaddy',
    displayName: 'GoDaddy',
    description: 'Import domains from your GoDaddy account using API credentials',
    docsUrl: 'https://developer.godaddy.com/getstarted',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'text',
        placeholder: 'Your GoDaddy API Key',
        helpText: 'Generate API credentials from GoDaddy Developer Portal',
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'API Secret',
        type: 'password',
        placeholder: 'Your GoDaddy API Secret',
        helpText: 'The secret associated with your API Key',
        required: true,
      },
    ],
  };

  /**
   * Effectue une requête authentifiée vers l'API GoDaddy
   */
  private async request<T>(
    credentials: GoDaddyCredentials,
    method: string,
    path: string
  ): Promise<T> {
    const url = `${GODADDY_API_URL}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `sso-key ${credentials.apiKey}:${credentials.apiSecret}`,
    };

    const response = await fetch(url, {
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GoDaddy API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as GoDaddyCredentials;
      await this.request<GoDaddyDomain[]>(creds, 'GET', '/domains?statusGroups=VISIBLE&limit=1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as GoDaddyCredentials;
    const domains = await this.request<GoDaddyDomain[]>(
      creds,
      'GET',
      '/domains?statusGroups=VISIBLE&limit=1000'
    );
    return domains.map((d) => d.domain);
  }

  /**
   * Convertit un domaine GoDaddy en DomainInfo
   */
  private toDomainInfo(domain: GoDaddyDomain): DomainInfo {
    return {
      domain_name: domain.domain,
      expiry_date: domain.expires ? new Date(domain.expires) : null,
      registration_date: domain.createdAt ? new Date(domain.createdAt) : null,
      dns_servers: domain.nameServers || [],
      auto_renew: domain.renewAuto,
      status: domain.status,
      registrar_name: 'GoDaddy',
    };
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const creds = credentials as GoDaddyCredentials;

    try {
      const domainInfo = await this.request<GoDaddyDomain>(
        creds,
        'GET',
        `/domains/${encodeURIComponent(domain)}`
      );
      return this.toDomainInfo(domainInfo);
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'GoDaddy',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as GoDaddyCredentials;
    const domains = await this.request<GoDaddyDomain[]>(
      creds,
      'GET',
      '/domains?statusGroups=VISIBLE&limit=1000'
    );
    return domains.map((d) => this.toDomainInfo(d));
  }
}

/**
 * Instance singleton du provider GoDaddy
 */
export const godaddyProvider = new GoDaddyProvider();
