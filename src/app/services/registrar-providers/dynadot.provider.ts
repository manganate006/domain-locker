/**
 * Dynadot Registrar Provider
 *
 * Documentation API : https://www.dynadot.com/domain/api3.html
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface DynadotCredentials extends ProviderCredentials {
  apiKey: string;
}

const DYNADOT_API_URL = 'https://api.dynadot.com/api3.json';

export class DynadotProvider implements RegistrarProvider {
  readonly name = 'dynadot';

  readonly config: ProviderConfig = {
    name: 'dynadot',
    displayName: 'Dynadot',
    description: 'Import domains from your Dynadot account',
    docsUrl: 'https://www.dynadot.com/domain/api3.html',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your Dynadot API Key',
        helpText: 'Generate from My Account → API',
        required: true,
      },
    ],
  };

  private async request(credentials: DynadotCredentials, command: string, params: Record<string, string> = {}): Promise<any> {
    const queryParams = new URLSearchParams({
      key: credentials.apiKey,
      command,
      ...params,
    });

    const response = await fetch(`${DYNADOT_API_URL}?${queryParams.toString()}`);
    if (!response.ok) throw new Error(`Dynadot API error: ${response.status}`);

    const data = await response.json();
    if (data.Status !== 'success' && data.status !== 'success') {
      throw new Error(`Dynadot API error: ${data.Error || data.error || 'Unknown'}`);
    }
    return data;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as DynadotCredentials, 'list_domain');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const data = await this.request(credentials as DynadotCredentials, 'list_domain');
    const domains = data.ListDomainInfoResponse?.DomainInfoList || data.DomainInfoList || [];
    return Array.isArray(domains) ? domains.map((d: any) => d.Domain || d.domain) : [];
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const data = await this.request(credentials as DynadotCredentials, 'domain_info', { domain });
      const info = data.DomainInfoResponse || data;

      return {
        domain_name: domain,
        expiry_date: info.Expiration ? new Date(info.Expiration) : null,
        registration_date: info.Registration ? new Date(info.Registration) : null,
        dns_servers: info.NameServers || [],
        auto_renew: info.RenewOption === 'auto',
        registrar_name: 'Dynadot',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'Dynadot' };
    }
  }

  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const data = await this.request(credentials as DynadotCredentials, 'list_domain');
    const domains = data.ListDomainInfoResponse?.DomainInfoList || data.DomainInfoList || [];

    return (Array.isArray(domains) ? domains : []).map((d: any) => ({
      domain_name: d.Domain || d.domain,
      expiry_date: d.Expiration ? new Date(d.Expiration) : null,
      registration_date: d.Registration ? new Date(d.Registration) : null,
      dns_servers: d.NameServers || [],
      auto_renew: d.RenewOption === 'auto',
      registrar_name: 'Dynadot',
    }));
  }
}

export const dynadotProvider = new DynadotProvider();
