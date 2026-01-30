/**
 * DNSimple Registrar Provider
 *
 * Documentation API : https://developer.dnsimple.com/v2/
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface DnSimpleCredentials extends ProviderCredentials {
  accountId: string;
  apiToken: string;
}

const DNSIMPLE_API_URL = 'https://api.dnsimple.com/v2';

export class DnSimpleProvider implements RegistrarProvider {
  readonly name = 'dnsimple';

  readonly config: ProviderConfig = {
    name: 'dnsimple',
    displayName: 'DNSimple',
    description: 'Import domains from your DNSimple account',
    docsUrl: 'https://developer.dnsimple.com/v2/',
    credentialFields: [
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        placeholder: 'Your DNSimple Account ID',
        helpText: 'Found in Account → Account Settings',
        required: true,
      },
      {
        key: 'apiToken',
        label: 'API Token',
        type: 'password',
        placeholder: 'Your DNSimple API Token',
        helpText: 'Create from Account → Automation',
        required: true,
      },
    ],
  };

  private async request<T>(credentials: DnSimpleCredentials, path: string): Promise<T> {
    const response = await fetch(`${DNSIMPLE_API_URL}/${credentials.accountId}${path}`, {
      headers: {
        'Authorization': `Bearer ${credentials.apiToken}`,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`DNSimple API error: ${response.status}`);
    return response.json();
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      const creds = credentials as DnSimpleCredentials;
      await this.request(creds, '/domains?per_page=1');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as DnSimpleCredentials;
    const allDomains: string[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data: any = await this.request(creds, `/domains?page=${page}&per_page=100`);
      allDomains.push(...(data.data || []).map((d: any) => d.name));
      hasMore = data.pagination?.current_page < data.pagination?.total_pages;
      page++;
    }

    return allDomains;
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const creds = credentials as DnSimpleCredentials;
      const data: any = await this.request(creds, `/domains/${domain}`);
      const d = data.data;

      return {
        domain_name: d.name,
        expiry_date: d.expires_at ? new Date(d.expires_at) : null,
        registration_date: d.created_at ? new Date(d.created_at) : null,
        auto_renew: d.auto_renew,
        status: d.state,
        registrar_name: 'DNSimple',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'DNSimple' };
    }
  }

  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const creds = credentials as DnSimpleCredentials;
    const allDomains: DomainInfo[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data: any = await this.request(creds, `/domains?page=${page}&per_page=100`);
      for (const d of data.data || []) {
        allDomains.push({
          domain_name: d.name,
          expiry_date: d.expires_at ? new Date(d.expires_at) : null,
          registration_date: d.created_at ? new Date(d.created_at) : null,
          auto_renew: d.auto_renew,
          status: d.state,
          registrar_name: 'DNSimple',
        });
      }
      hasMore = data.pagination?.current_page < data.pagination?.total_pages;
      page++;
    }

    return allDomains;
  }
}

export const dnsimpleProvider = new DnSimpleProvider();
