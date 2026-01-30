/**
 * ResellerClub Registrar Provider
 *
 * Documentation API : https://manage.resellerclub.com/kb/answer/744
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface ResellerClubCredentials extends ProviderCredentials {
  resellerId: string;
  apiKey: string;
}

const RESELLERCLUB_API_URL = 'https://httpapi.com/api';

export class ResellerClubProvider implements RegistrarProvider {
  readonly name = 'resellerclub';

  readonly config: ProviderConfig = {
    name: 'resellerclub',
    displayName: 'ResellerClub',
    description: 'Import domains from your ResellerClub account',
    docsUrl: 'https://manage.resellerclub.com/kb/answer/744',
    credentialFields: [
      {
        key: 'resellerId',
        label: 'Reseller ID',
        type: 'text',
        placeholder: 'Your ResellerClub Reseller ID',
        required: true,
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your ResellerClub API Key',
        helpText: 'Found in Settings → API',
        required: true,
      },
    ],
  };

  private async request(credentials: ResellerClubCredentials, endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const queryParams = new URLSearchParams({
      'auth-userid': credentials.resellerId,
      'api-key': credentials.apiKey,
      ...params,
    });

    const response = await fetch(`${RESELLERCLUB_API_URL}${endpoint}?${queryParams.toString()}`);
    if (!response.ok) throw new Error(`ResellerClub API error: ${response.status}`);

    const data = await response.json();
    if (data.status === 'ERROR') {
      throw new Error(`ResellerClub API error: ${data.message || 'Unknown'}`);
    }
    return data;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as ResellerClubCredentials, '/domains/search.json', {
        'no-of-records': '1',
        'page-no': '1',
      });
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const creds = credentials as ResellerClubCredentials;
    const allDomains: string[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await this.request(creds, '/domains/search.json', {
        'no-of-records': '100',
        'page-no': String(page),
      });

      if (data.recsonpage && parseInt(data.recsonpage, 10) > 0) {
        // ResellerClub returns domains as numbered keys (1, 2, 3, etc.)
        for (const key of Object.keys(data)) {
          if (/^\d+$/.test(key) && data[key].entity?.domainname) {
            allDomains.push(data[key].entity.domainname);
          }
        }
        hasMore = allDomains.length < parseInt(data.recsindb || '0', 10);
        page++;
      } else {
        hasMore = false;
      }

      if (hasMore) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return allDomains;
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const data = await this.request(credentials as ResellerClubCredentials, '/domains/details-by-name.json', {
        'domain-name': domain,
        'options': 'All',
      });

      const ns: string[] = [];
      for (let i = 1; i <= 13; i++) {
        if (data[`ns${i}`]) ns.push(data[`ns${i}`]);
      }

      return {
        domain_name: domain,
        expiry_date: data.endtime ? new Date(parseInt(data.endtime, 10) * 1000) : null,
        registration_date: data.creationtime ? new Date(parseInt(data.creationtime, 10) * 1000) : null,
        dns_servers: ns,
        auto_renew: data.isOrderSuspendedUponExpiry === 'false',
        status: data.currentstatus,
        registrar_name: 'ResellerClub',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'ResellerClub' };
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

export const resellerclubProvider = new ResellerClubProvider();
