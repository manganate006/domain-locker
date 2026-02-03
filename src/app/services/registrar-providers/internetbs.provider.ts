/**
 * Internet.bs Registrar Provider
 *
 * Documentation API : https://internetbs.net/ResellerRegistrarDomainNameAPI
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface InternetBsCredentials extends ProviderCredentials {
  apiKey: string;
  password: string;
}

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

export class InternetBsProvider implements RegistrarProvider {
  readonly name = 'internetbs';

  readonly config: ProviderConfig = {
    name: 'internetbs',
    displayName: 'Internet.bs',
    description: 'Import domains from your Internet.bs account',
    docsUrl: 'https://internetbs.net/ResellerRegistrarDomainNameAPI',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'text',
        placeholder: 'Your Internet.bs API Key',
        required: true,
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        placeholder: 'Your Internet.bs API Password',
        required: true,
      },
    ],
  };

  private async request(credentials: InternetBsCredentials, endpoint: string, params: Record<string, string> = {}): Promise<any> {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'internetbs',
        credentials: {
          apiKey: credentials.apiKey,
          password: credentials.password,
        },
        path: endpoint,
        params,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Internet.bs API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`Internet.bs API error: ${result.error}`);
    }

    const data = result.data;
    if (data.status === 'FAILURE') {
      throw new Error(`Internet.bs API error: ${data.message || 'Unknown'}`);
    }
    return data;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as InternetBsCredentials, '/Domain/List');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const data = await this.request(credentials as InternetBsCredentials, '/Domain/List');
    return data.domain || [];
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const data = await this.request(credentials as InternetBsCredentials, '/Domain/Info', { Domain: domain });

      return {
        domain_name: domain,
        expiry_date: data.expirationdate ? new Date(data.expirationdate) : null,
        registration_date: data.registrationdate ? new Date(data.registrationdate) : null,
        dns_servers: data.nameserver || [],
        auto_renew: data.autorenew === 'YES',
        status: data.domainstatus,
        registrar_name: 'Internet.bs',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'Internet.bs' };
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

export const internetbsProvider = new InternetBsProvider();
