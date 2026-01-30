/**
 * Name.com Registrar Provider
 *
 * Documentation API : https://www.name.com/api-docs
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface NameComCredentials extends ProviderCredentials {
  username: string;
  apiToken: string;
}

const NAMECOM_API_URL = 'https://api.name.com/v4';

export class NameComProvider implements RegistrarProvider {
  readonly name = 'namecom';

  readonly config: ProviderConfig = {
    name: 'namecom',
    displayName: 'Name.com',
    description: 'Import domains from your Name.com account',
    docsUrl: 'https://www.name.com/api-docs',
    credentialFields: [
      {
        key: 'username',
        label: 'Username',
        type: 'text',
        placeholder: 'Your Name.com username',
        required: true,
      },
      {
        key: 'apiToken',
        label: 'API Token',
        type: 'password',
        placeholder: 'Your API Token',
        helpText: 'Generate from Account → API Token',
        required: true,
      },
    ],
  };

  private async request<T>(credentials: NameComCredentials, path: string): Promise<T> {
    const auth = btoa(`${credentials.username}:${credentials.apiToken}`);
    const response = await fetch(`${NAMECOM_API_URL}${path}`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Name.com API error: ${response.status}`);
    return response.json();
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as NameComCredentials, '/domains');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as NameComCredentials;
    const allDomains: string[] = [];
    let nextPage = 1;

    while (nextPage) {
      const data: any = await this.request(creds, `/domains?page=${nextPage}`);
      allDomains.push(...(data.domains || []).map((d: any) => d.domainName));
      nextPage = data.nextPage || 0;
    }

    return allDomains;
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const data: any = await this.request(credentials as NameComCredentials, `/domains/${domain}`);
      return {
        domain_name: data.domainName,
        expiry_date: data.expireDate ? new Date(data.expireDate) : null,
        registration_date: data.createDate ? new Date(data.createDate) : null,
        dns_servers: data.nameservers || [],
        auto_renew: data.autorenewEnabled,
        registrar_name: 'Name.com',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'Name.com' };
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

export const namecomProvider = new NameComProvider();
