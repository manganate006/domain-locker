/**
 * IONOS Registrar Provider
 *
 * Implémentation du provider pour l'API IONOS.
 * Utilise un proxy backend pour contourner les restrictions CORS.
 *
 * Documentation API IONOS :
 * - https://developer.hosting.ionos.com/docs/domains
 *
 * Authentification :
 * - Header X-API-Key avec format "prefix.secret"
 * - Création de clé API : https://my.ionos.com/shop/api-key
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
 * Réponse de l'API IONOS pour /domains/v1/domains
 */
interface IonosDomainInfo {
  name: string;
  domain?: string;
  expirationDate?: string;
  registrationDate?: string;
  status?: string;
  autoRenew?: boolean;
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
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const ionosCreds = credentials as IonosCredentials;
      await this.request<IonosDomainInfo[]>(ionosCreds, 'GET', '/domains/v1/domains');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const ionosCreds = credentials as IonosCredentials;
    const domains = await this.request<IonosDomainInfo[]>(ionosCreds, 'GET', '/domains/v1/domains');
    return domains.map((d) => d.name || d.domain || '').filter(Boolean);
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const ionosCreds = credentials as IonosCredentials;

    try {
      const domainInfo = await this.request<IonosDomainInfo>(
        ionosCreds,
        'GET',
        `/domains/v1/domains/${encodeURIComponent(domain)}`
      );

      return {
        domain_name: domainInfo.name || domainInfo.domain || domain,
        expiry_date: domainInfo.expirationDate ? new Date(domainInfo.expirationDate) : null,
        registration_date: domainInfo.registrationDate ? new Date(domainInfo.registrationDate) : null,
        auto_renew: domainInfo.autoRenew,
        status: domainInfo.status,
        registrar_name: 'IONOS',
      };
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'IONOS',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const ionosCreds = credentials as IonosCredentials;
    const domains = await this.request<IonosDomainInfo[]>(ionosCreds, 'GET', '/domains/v1/domains');

    return domains.map((d) => ({
      domain_name: d.name || d.domain || '',
      expiry_date: d.expirationDate ? new Date(d.expirationDate) : null,
      registration_date: d.registrationDate ? new Date(d.registrationDate) : null,
      auto_renew: d.autoRenew,
      status: d.status,
      registrar_name: 'IONOS',
    }));
  }
}

/**
 * Instance singleton du provider IONOS
 */
export const ionosProvider = new IonosProvider();
