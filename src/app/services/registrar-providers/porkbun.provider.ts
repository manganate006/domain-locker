/**
 * Porkbun Registrar Provider
 *
 * Implémentation du provider pour l'API Porkbun.
 * Utilise l'authentification par API Key + Secret Key.
 *
 * Documentation API Porkbun :
 * https://porkbun.com/api/json/v3/documentation
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials Porkbun
 */
export interface PorkbunCredentials extends ProviderCredentials {
  apiKey: string;
  secretKey: string;
}

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

/**
 * Réponse domaine Porkbun
 */
interface PorkbunDomain {
  domain: string;
  status: string;
  tld: string;
  createDate: string;
  expireDate: string;
  securityLock: string;
  whoisPrivacy: string;
  autoRenew: number;
  notLocal: number;
}

/**
 * Réponse API Porkbun
 */
interface PorkbunResponse<T> {
  status: string;
  domains?: T[];
  ns?: string[];
  message?: string;
}

/**
 * Provider Porkbun pour l'import de domaines
 */
export class PorkbunProvider implements RegistrarProvider {
  readonly name = 'porkbun';

  readonly config: ProviderConfig = {
    name: 'porkbun',
    displayName: 'Porkbun',
    description: 'Import domains from your Porkbun account using API credentials',
    docsUrl: 'https://porkbun.com/api/json/v3/documentation',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'pk1_xxxxxxxx',
        helpText: 'Generate from Account → API Access',
        required: true,
      },
      {
        key: 'secretKey',
        label: 'Secret API Key',
        type: 'password',
        placeholder: 'sk1_xxxxxxxx',
        helpText: 'The secret key associated with your API key',
        required: true,
      },
    ],
  };

  /**
   * Effectue une requête authentifiée vers l'API Porkbun via le proxy backend
   */
  private async request<T>(
    credentials: PorkbunCredentials,
    endpoint: string,
    body: Record<string, any> = {}
  ): Promise<PorkbunResponse<T>> {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'porkbun',
        credentials: {
          apiKey: credentials.apiKey,
          secretKey: credentials.secretKey,
        },
        method: 'POST',
        path: endpoint,
        body: JSON.stringify(body),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Porkbun API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`Porkbun API error: ${result.error}`);
    }

    const data = result.data;

    if (data.status !== 'SUCCESS') {
      throw new Error(`Porkbun API error: ${data.message || 'Unknown error'}`);
    }

    return data;
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as PorkbunCredentials;
      await this.request<any>(creds, '/ping');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as PorkbunCredentials;
    const response = await this.request<PorkbunDomain>(creds, '/domain/listAll');
    return (response.domains || []).map((d) => d.domain);
  }

  /**
   * Récupère les DNS servers d'un domaine
   */
  private async getDnsServers(credentials: PorkbunCredentials, domain: string): Promise<string[]> {
    try {
      const response = await this.request<any>(credentials, `/domain/getNs/${domain}`);
      return response.ns || [];
    } catch {
      return [];
    }
  }

  /**
   * Convertit un domaine Porkbun en DomainInfo
   */
  private toDomainInfo(domain: PorkbunDomain, dnsServers: string[] = []): DomainInfo {
    return {
      domain_name: domain.domain,
      expiry_date: domain.expireDate ? new Date(domain.expireDate) : null,
      registration_date: domain.createDate ? new Date(domain.createDate) : null,
      dns_servers: dnsServers,
      auto_renew: domain.autoRenew === 1,
      status: domain.status,
      registrar_name: 'Porkbun',
    };
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const creds = credentials as PorkbunCredentials;

    try {
      // Porkbun n'a pas d'endpoint pour un seul domaine, on récupère la liste
      const response = await this.request<PorkbunDomain>(creds, '/domain/listAll');
      const domainInfo = (response.domains || []).find((d) => d.domain === domain);

      if (!domainInfo) {
        return {
          domain_name: domain,
          expiry_date: null,
          registrar_name: 'Porkbun',
        };
      }

      const dnsServers = await this.getDnsServers(creds, domain);
      return this.toDomainInfo(domainInfo, dnsServers);
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'Porkbun',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as PorkbunCredentials;
    const response = await this.request<PorkbunDomain>(creds, '/domain/listAll');
    const domains = response.domains || [];

    const domainsInfo: DomainInfo[] = [];

    for (const domain of domains) {
      const dnsServers = await this.getDnsServers(creds, domain.domain);
      domainsInfo.push(this.toDomainInfo(domain, dnsServers));

      // Pause pour respecter les rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return domainsInfo;
  }
}

/**
 * Instance singleton du provider Porkbun
 */
export const porkbunProvider = new PorkbunProvider();
