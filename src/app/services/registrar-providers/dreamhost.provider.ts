/**
 * DreamHost Registrar Provider
 *
 * Documentation API : https://help.dreamhost.com/hc/en-us/articles/217560167-API-overview
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface DreamHostCredentials extends ProviderCredentials {
  apiKey: string;
}

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

export class DreamHostProvider implements RegistrarProvider {
  readonly name = 'dreamhost';

  readonly config: ProviderConfig = {
    name: 'dreamhost',
    displayName: 'DreamHost',
    description: 'Import domains from your DreamHost account',
    docsUrl: 'https://help.dreamhost.com/hc/en-us/articles/217560167-API-overview',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your DreamHost API Key',
        helpText: 'Generate from Panel → Web Panel API',
        required: true,
      },
    ],
  };

  private async request(credentials: DreamHostCredentials, cmd: string): Promise<any> {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'dreamhost',
        credentials: {
          apiKey: credentials.apiKey,
        },
        command: cmd,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DreamHost API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`DreamHost API error: ${result.error}`);
    }

    const data = result.data;
    if (data.result !== 'success') {
      throw new Error(`DreamHost API error: ${data.data || 'Unknown'}`);
    }
    return data;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as DreamHostCredentials, 'domain-list_registrations');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const data = await this.request(credentials as DreamHostCredentials, 'domain-list_registrations');
    return (data.data || []).map((d: any) => d.domain);
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    const data = await this.request(credentials as DreamHostCredentials, 'domain-list_registrations');
    const domainData = (data.data || []).find((d: any) => d.domain === domain);

    if (!domainData) {
      return { domain_name: domain, expiry_date: null, registrar_name: 'DreamHost' };
    }

    return {
      domain_name: domain,
      expiry_date: domainData.expires ? new Date(domainData.expires) : null,
      registration_date: domainData.created ? new Date(domainData.created) : null,
      dns_servers: domainData.ns ? [domainData.ns] : [],
      auto_renew: domainData.autorenew === '1',
      registrar_name: 'DreamHost',
    };
  }

  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const data = await this.request(credentials as DreamHostCredentials, 'domain-list_registrations');
    return (data.data || []).map((d: any) => ({
      domain_name: d.domain,
      expiry_date: d.expires ? new Date(d.expires) : null,
      registration_date: d.created ? new Date(d.created) : null,
      dns_servers: d.ns ? [d.ns] : [],
      auto_renew: d.autorenew === '1',
      registrar_name: 'DreamHost',
    }));
  }
}

export const dreamhostProvider = new DreamHostProvider();
