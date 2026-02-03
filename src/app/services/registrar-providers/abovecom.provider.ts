/**
 * Above.com Registrar Provider
 *
 * Documentation API : https://www.above.com/api
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface AboveComCredentials extends ProviderCredentials {
  apiKey: string;
}

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

export class AboveComProvider implements RegistrarProvider {
  readonly name = 'abovecom';

  readonly config: ProviderConfig = {
    name: 'abovecom',
    displayName: 'Above.com',
    description: 'Import domains from your Above.com account',
    docsUrl: 'https://www.above.com/api-doc.html',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your Above.com API Key',
        helpText: 'Generate from your Above.com dashboard',
        required: true,
      },
    ],
  };

  private async request(credentials: AboveComCredentials, endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'abovecom',
        credentials: {
          apiKey: credentials.apiKey,
        },
        path: endpoint,
        params,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Above.com API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`Above.com API error: ${result.error}`);
    }

    const data = result.data;
    if (data.error) {
      throw new Error(`Above.com API error: ${data.error}`);
    }
    return data;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as AboveComCredentials, '/domains');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const data = await this.request(credentials as AboveComCredentials, '/domains');
    return (data.domains || []).map((d: any) => d.domain || d);
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const data = await this.request(credentials as AboveComCredentials, '/domain/info', { domain });

      return {
        domain_name: domain,
        expiry_date: data.expiry_date ? new Date(data.expiry_date) : null,
        registration_date: data.registration_date ? new Date(data.registration_date) : null,
        dns_servers: data.nameservers || [],
        auto_renew: data.auto_renew === true || data.auto_renew === 'true',
        status: data.status,
        registrar_name: 'Above.com',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'Above.com' };
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

export const abovecomProvider = new AboveComProvider();
