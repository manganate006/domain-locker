/**
 * NameSilo Registrar Provider
 *
 * Implémentation du provider pour l'API NameSilo.
 * Utilise l'authentification par API Key.
 *
 * Documentation API NameSilo :
 * https://www.namesilo.com/api-reference
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials NameSilo
 */
export interface NameSiloCredentials extends ProviderCredentials {
  apiKey: string;
}

/**
 * Base URL de l'API NameSilo
 */
const NAMESILO_API_URL = 'https://www.namesilo.com/api';

/**
 * Provider NameSilo pour l'import de domaines
 */
export class NameSiloProvider implements RegistrarProvider {
  readonly name = 'namesilo';

  readonly config: ProviderConfig = {
    name: 'namesilo',
    displayName: 'NameSilo',
    description: 'Import domains from your NameSilo account using API key',
    docsUrl: 'https://www.namesilo.com/api-reference',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your NameSilo API Key',
        helpText: 'Generate from Account → API Manager',
        required: true,
      },
    ],
  };

  /**
   * Parse XML response to object
   */
  private parseXml(xmlText: string): any {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseNode = (node: Element): any => {
      const result: any = {};

      for (const child of Array.from(node.children)) {
        const childValue =
          child.children.length > 0 ? parseNode(child) : child.textContent?.trim() || '';
        const tagName = child.tagName;

        if (result[tagName]) {
          if (!Array.isArray(result[tagName])) {
            result[tagName] = [result[tagName]];
          }
          result[tagName].push(childValue);
        } else {
          result[tagName] = childValue;
        }
      }

      return result;
    };

    return parseNode(xmlDoc.documentElement);
  }

  /**
   * Effectue une requête vers l'API NameSilo
   */
  private async request(credentials: NameSiloCredentials, operation: string, params: Record<string, string> = {}): Promise<any> {
    const queryParams = new URLSearchParams({
      version: '1',
      type: 'xml',
      key: credentials.apiKey,
      ...params,
    });

    const url = `${NAMESILO_API_URL}/${operation}?${queryParams.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`NameSilo API error (${response.status})`);
    }

    const xmlText = await response.text();
    const result = this.parseXml(xmlText);

    if (result.reply?.detail !== 'success') {
      throw new Error(`NameSilo API error: ${result.reply?.detail || 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as NameSiloCredentials;
      await this.request(creds, 'listDomains');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as NameSiloCredentials;
    const response = await this.request(creds, 'listDomains');

    const domains = response.reply?.domains?.domain;
    if (!domains) return [];

    return Array.isArray(domains) ? domains : [domains];
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const creds = credentials as NameSiloCredentials;

    try {
      const response = await this.request(creds, 'getDomainInfo', { domain });
      const info = response.reply;

      const nameservers: string[] = [];
      if (info.nameservers?.nameserver) {
        const ns = info.nameservers.nameserver;
        if (Array.isArray(ns)) {
          nameservers.push(...ns);
        } else {
          nameservers.push(ns);
        }
      }

      return {
        domain_name: domain,
        expiry_date: info.expires ? new Date(info.expires) : null,
        registration_date: info.created ? new Date(info.created) : null,
        dns_servers: nameservers,
        auto_renew: info.auto_renew === 'Yes',
        status: info.status,
        registrar_name: 'NameSilo',
      };
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'NameSilo',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as NameSiloCredentials;
    const domainList = await this.getDomainList(creds);

    const domainsInfo: DomainInfo[] = [];

    for (const domain of domainList) {
      const info = await this.getDomainInfo(creds, domain);
      domainsInfo.push(info);

      // Pause pour respecter les rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return domainsInfo;
  }
}

/**
 * Instance singleton du provider NameSilo
 */
export const namesiloProvider = new NameSiloProvider();
