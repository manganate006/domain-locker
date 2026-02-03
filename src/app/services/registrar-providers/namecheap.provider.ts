/**
 * Namecheap Registrar Provider
 *
 * Implémentation du provider pour l'API Namecheap.
 * Utilise l'authentification par API Key + Username + IP Whitelist.
 * Les requêtes passent par le proxy backend pour contourner CORS.
 *
 * Documentation API Namecheap :
 * https://www.namecheap.com/support/api/intro/
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Credentials Namecheap
 */
export interface NamecheapCredentials extends ProviderCredentials {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
}

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

/**
 * Provider Namecheap pour l'import de domaines
 */
export class NamecheapProvider implements RegistrarProvider {
  readonly name = 'namecheap';

  readonly config: ProviderConfig = {
    name: 'namecheap',
    displayName: 'Namecheap',
    description: 'Import domains from your Namecheap account using API credentials',
    docsUrl: 'https://www.namecheap.com/support/api/intro/',
    credentialFields: [
      {
        key: 'apiUser',
        label: 'API User',
        type: 'text',
        placeholder: 'Your Namecheap API username',
        helpText: 'Usually same as your Namecheap username',
        required: true,
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your Namecheap API Key',
        helpText: 'Generate from Profile → Tools → API Access',
        required: true,
      },
      {
        key: 'username',
        label: 'Username',
        type: 'text',
        placeholder: 'Your Namecheap username',
        helpText: 'Your Namecheap account username',
        required: true,
      },
      {
        key: 'clientIp',
        label: 'Whitelisted IP',
        type: 'text',
        placeholder: 'Your whitelisted IP address',
        helpText: 'The IP address you whitelisted in Namecheap API settings',
        required: true,
      },
    ],
  };

  /**
   * Parse XML response to object
   */
  private parseXml(xmlText: string): any {
    // Simple XML parser for Namecheap responses
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseNode = (node: Element): any => {
      const result: any = {};

      // Parse attributes
      for (const attr of Array.from(node.attributes)) {
        result[`@${attr.name}`] = attr.value;
      }

      // Parse child elements
      for (const child of Array.from(node.children)) {
        const childValue = parseNode(child);
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

      // If no children, get text content
      if (node.children.length === 0) {
        const text = node.textContent?.trim();
        if (text && Object.keys(result).length === 0) {
          return text;
        }
        if (text) {
          result['#text'] = text;
        }
      }

      return result;
    };

    return parseNode(xmlDoc.documentElement);
  }

  /**
   * Effectue une requête vers l'API Namecheap via le proxy backend
   */
  private async request(credentials: NamecheapCredentials, command: string, params: Record<string, string> = {}): Promise<any> {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'namecheap',
        credentials: {
          apiUser: credentials.apiUser,
          apiKey: credentials.apiKey,
          username: credentials.username,
          clientIp: credentials.clientIp,
        },
        command,
        params,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Namecheap API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`Namecheap API error: ${result.error}`);
    }

    return result.data;
  }

  /**
   * Vérifie si les credentials sont valides
   */
  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as NamecheapCredentials;
      await this.request(creds, 'namecheap.domains.getList', { PageSize: '1' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère tous les domaines avec pagination
   */
  private async fetchAllDomains(credentials: NamecheapCredentials): Promise<any[]> {
    const allDomains: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request(credentials, 'namecheap.domains.getList', {
        PageSize: '100',
        Page: String(page),
      });

      const commandResponse = response.CommandResponse;
      const domainList = commandResponse?.DomainGetListResult?.Domain;

      if (domainList) {
        const domains = Array.isArray(domainList) ? domainList : [domainList];
        allDomains.push(...domains);
      }

      const paging = commandResponse?.Paging;
      if (paging) {
        const totalItems = parseInt(paging.TotalItems?.['#text'] || paging.TotalItems || '0', 10);
        const pageSize = parseInt(paging.PageSize?.['#text'] || paging.PageSize || '100', 10);
        hasMore = page * pageSize < totalItems;
        page++;
      } else {
        hasMore = false;
      }

      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return allDomains;
  }

  /**
   * Récupère la liste des domaines
   */
  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as NamecheapCredentials;
    const domains = await this.fetchAllDomains(creds);
    return domains.map((d) => d['@Name'] || d.Name);
  }

  /**
   * Récupère les informations détaillées d'un domaine
   */
  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const creds = credentials as NamecheapCredentials;

    try {
      const response = await this.request(creds, 'namecheap.domains.getInfo', {
        DomainName: domain,
      });

      const domainInfo = response.CommandResponse?.DomainGetInfoResult;

      if (!domainInfo) {
        throw new Error('Domain info not found');
      }

      const dnsDetails = domainInfo.DnsDetails;
      const nameservers: string[] = [];

      if (dnsDetails?.Nameserver) {
        const ns = dnsDetails.Nameserver;
        if (Array.isArray(ns)) {
          nameservers.push(...ns.map((n: any) => n['#text'] || n));
        } else {
          nameservers.push(ns['#text'] || ns);
        }
      }

      return {
        domain_name: domainInfo['@DomainName'] || domain,
        expiry_date: domainInfo.DomainDetails?.ExpiredDate
          ? new Date(domainInfo.DomainDetails.ExpiredDate)
          : null,
        registration_date: domainInfo.DomainDetails?.CreatedDate
          ? new Date(domainInfo.DomainDetails.CreatedDate)
          : null,
        dns_servers: nameservers,
        auto_renew: domainInfo.Whoisguard?.['@AutoRenew'] === 'true',
        status: domainInfo['@Status'],
        registrar_name: 'Namecheap',
      };
    } catch {
      return {
        domain_name: domain,
        expiry_date: null,
        registrar_name: 'Namecheap',
      };
    }
  }

  /**
   * Récupère les informations de tous les domaines
   */
  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as NamecheapCredentials;
    const domains = await this.fetchAllDomains(creds);

    const domainsInfo: DomainInfo[] = [];

    for (const domain of domains) {
      const domainName = domain['@Name'] || domain.Name;

      try {
        const info = await this.getDomainInfo(creds, domainName);
        domainsInfo.push(info);
      } catch {
        // Fallback avec les infos de base de la liste
        domainsInfo.push({
          domain_name: domainName,
          expiry_date: domain['@Expires'] ? new Date(domain['@Expires']) : null,
          registration_date: domain['@Created'] ? new Date(domain['@Created']) : null,
          auto_renew: domain['@AutoRenew'] === 'true',
          registrar_name: 'Namecheap',
        });
      }

      // Pause pour respecter les rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return domainsInfo;
  }
}

/**
 * Instance singleton du provider Namecheap
 */
export const namecheapProvider = new NamecheapProvider();
