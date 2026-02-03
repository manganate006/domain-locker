/**
 * OVH Registrar Provider
 *
 * Implémentation du provider pour l'API OVH.
 * Utilise un proxy backend pour contourner les restrictions CORS.
 *
 * Documentation API OVH :
 * - Console : https://eu.api.ovh.com/console/?branch=v1&section=/domain
 * - Création tokens : https://eu.api.ovh.com/createToken/
 *
 * Permissions requises :
 * - GET /domain
 * - GET /domain/*
 */

import {
  RegistrarProvider,
  ProviderConfig,
  OvhCredentials,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Réponse de l'API OVH pour /domain/{domain}/serviceInfos
 */
interface OvhServiceInfo {
  domain: string;
  contactAdmin: string;
  contactTech: string;
  contactBilling: string;
  creation: string;
  expiration: string;
  status: string;
  renew?: {
    automatic: boolean;
    deleteAtExpiration: boolean;
    forced: boolean;
    period?: number;
  };
}

/**
 * Provider OVH pour l'import de domaines
 */
export class OvhProvider implements RegistrarProvider {
  readonly name = 'ovh';

  readonly config: ProviderConfig = {
    name: 'ovh',
    displayName: 'OVH',
    description: 'Import domains from your OVH account using API credentials',
    docsUrl: 'https://eu.api.ovh.com/createToken/',
    credentialFields: [
      {
        key: 'applicationKey',
        label: 'Application Key',
        type: 'text',
        placeholder: 'xxxxxxxxxxxxxxxx',
        helpText: 'Your OVH Application Key (AK)',
        required: true,
      },
      {
        key: 'applicationSecret',
        label: 'Application Secret',
        type: 'password',
        placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        helpText: 'Your OVH Application Secret (AS)',
        required: true,
      },
      {
        key: 'consumerKey',
        label: 'Consumer Key',
        type: 'password',
        placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        helpText: 'Your OVH Consumer Key (CK)',
        required: true,
      },
      {
        key: 'endpoint',
        label: 'API Endpoint',
        type: 'text',
        placeholder: 'ovh-eu',
        helpText: 'API endpoint: ovh-eu (default), ovh-ca, ovh-us, kimsufi-eu, etc.',
        required: false,
      },
    ],
  };

  /**
   * Effectue une requête via le proxy backend pour contourner CORS
   */
  private async request<T>(
    credentials: OvhCredentials,
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
        provider: 'ovh',
        method,
        path,
        body: body || undefined,
        credentials: {
          applicationKey: credentials.applicationKey,
          applicationSecret: credentials.applicationSecret,
          consumerKey: credentials.consumerKey,
          endpoint: credentials.endpoint || 'ovh-eu',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Proxy error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.statusCode && result.statusCode >= 400) {
      throw new Error(`OVH API error (${result.statusCode}): ${JSON.stringify(result.body)}`);
    }

    if (result.error) {
      throw new Error(`OVH API error: ${JSON.stringify(result.data || result)}`);
    }

    return result.data as T;
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const ovhCreds = credentials as OvhCredentials;
      // Tenter de récupérer la liste des domaines comme test
      await this.request<string[]>(ovhCreds, 'GET', '/domain');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const ovhCreds = credentials as OvhCredentials;
    return this.request<string[]>(ovhCreds, 'GET', '/domain');
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const ovhCreds = credentials as OvhCredentials;

    try {
      const serviceInfo = await this.request<OvhServiceInfo>(
        ovhCreds,
        'GET',
        `/domain/${encodeURIComponent(domain)}/serviceInfos`
      );

      // Récupérer les serveurs DNS si possible
      let dnsServers: string[] = [];
      try {
        const dnsResponse = await this.request<{ nameServers: string[] }>(
          ovhCreds,
          'GET',
          `/domain/${encodeURIComponent(domain)}`
        );
        dnsServers = dnsResponse.nameServers || [];
      } catch {
        // Les DNS peuvent ne pas être accessibles selon les permissions
      }

      return {
        domain_name: domain,
        expiry_date: serviceInfo.expiration ? new Date(serviceInfo.expiration) : null,
        registration_date: serviceInfo.creation ? new Date(serviceInfo.creation) : null,
        dns_servers: dnsServers,
        auto_renew: serviceInfo.renew?.automatic ?? false,
        status: serviceInfo.status,
        registrar_name: 'OVH',
      };
    } catch (error) {
      // Retourner les infos minimales en cas d'erreur
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'OVH',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const domains = await this.getDomainList(credentials);
    const results: DomainInfo[] = [];

    // Traiter les domaines par lots pour éviter de surcharger l'API
    const batchSize = 5;
    for (let i = 0; i < domains.length; i += batchSize) {
      const batch = domains.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((domain) => this.getDomainInfo(credentials, domain))
      );
      results.push(...batchResults);

      // Pause entre les lots pour respecter les rate limits
      if (i + batchSize < domains.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return results;
  }
}

/**
 * Instance singleton du provider OVH
 */
export const ovhProvider = new OvhProvider();
