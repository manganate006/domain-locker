/**
 * NameBright Registrar Provider
 *
 * Documentation API : https://www.namebright.com/api
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface NameBrightCredentials extends ProviderCredentials {
  apiKey: string;
  apiSecret: string;
}

const NAMEBRIGHT_API_URL = 'https://api.namebright.com/rest';

export class NameBrightProvider implements RegistrarProvider {
  readonly name = 'namebright';

  readonly config: ProviderConfig = {
    name: 'namebright',
    displayName: 'NameBright',
    description: 'Import domains from your NameBright account',
    docsUrl: 'https://www.namebright.com/api',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key (App Name)',
        type: 'text',
        placeholder: 'Your NameBright App Name',
        required: true,
      },
      {
        key: 'apiSecret',
        label: 'API Secret',
        type: 'password',
        placeholder: 'Your NameBright API Secret',
        required: true,
      },
    ],
  };

  private async request<T>(credentials: NameBrightCredentials, path: string): Promise<T> {
    const auth = btoa(`${credentials.apiKey}:${credentials.apiSecret}`);
    const response = await fetch(`${NAMEBRIGHT_API_URL}${path}`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`NameBright API error: ${response.status}`);
    return response.json();
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as NameBrightCredentials, '/domains');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const data: any = await this.request(credentials as NameBrightCredentials, '/domains');
    return (data.domains || data || []).map((d: any) => d.domainName || d);
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const data: any = await this.request(credentials as NameBrightCredentials, `/domains/${domain}`);

      return {
        domain_name: domain,
        expiry_date: data.expirationDate ? new Date(data.expirationDate) : null,
        registration_date: data.creationDate ? new Date(data.creationDate) : null,
        dns_servers: data.nameServers || [],
        auto_renew: data.autoRenew,
        status: data.status,
        registrar_name: 'NameBright',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'NameBright' };
    }
  }

  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const domains = await this.getDomainList(credentials);
    const results: DomainInfo[] = [];

    for (const domain of domains) {
      results.push(await this.getDomainInfo(credentials, domain));
      await new Promise((r) => setTimeout(r, 100));
    }

    return results;
  }
}

export const namebrightProvider = new NameBrightProvider();
