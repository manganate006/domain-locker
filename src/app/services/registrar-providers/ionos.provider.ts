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
 * Réponse de l'API DNS IONOS pour /dns/v1/zones
 */
interface IonosZoneInfo {
  id: string;
  name: string;
  type: string;
}

/**
 * Réponse de l'API Domains IONOS (si activée)
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
   * Utilise l'API DNS car l'API Domains nécessite une activation spéciale
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const ionosCreds = credentials as IonosCredentials;
      // Essaie d'abord l'API DNS (plus courante)
      await this.request<IonosZoneInfo[]>(ionosCreds, 'GET', '/dns/v1/zones');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines via l'API DNS (zones)
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const ionosCreds = credentials as IonosCredentials;
    const zones = await this.request<IonosZoneInfo[]>(ionosCreds, 'GET', '/dns/v1/zones');
    return zones.map((z) => z.name).filter(Boolean);
  }

  /**
   * Récupère les informations détaillées d'un domaine
   * L'API DNS ne fournit pas les dates d'expiration
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    return {
      domain_name: domain,
      expiry_date: null, // L'API DNS ne fournit pas cette info
      registrar_name: 'IONOS',
    };
  }

  /**
   * Récupère les informations de tous les domaines via l'API DNS
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const ionosCreds = credentials as IonosCredentials;
    const zones = await this.request<IonosZoneInfo[]>(ionosCreds, 'GET', '/dns/v1/zones');

    return zones.map((z) => ({
      domain_name: z.name,
      expiry_date: null, // L'API DNS ne fournit pas cette info
      registrar_name: 'IONOS',
    }));
  }
}

/**
 * Instance singleton du provider IONOS
 */
export const ionosProvider = new IonosProvider();
