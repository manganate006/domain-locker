/**
 * eNom Registrar Provider
 *
 * Documentation API : https://api.enom.com/docs/
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

export interface EnomCredentials extends ProviderCredentials {
  uid: string;
  pw: string;
}

/**
 * URL du proxy backend pour contourner CORS
 */
const PROXY_URL = '/api/registrar-proxy';

export class EnomProvider implements RegistrarProvider {
  readonly name = 'enom';

  readonly config: ProviderConfig = {
    name: 'enom',
    displayName: 'eNom',
    description: 'Import domains from your eNom reseller account',
    docsUrl: 'https://api.enom.com/docs/',
    credentialFields: [
      {
        key: 'uid',
        label: 'Login ID',
        type: 'text',
        placeholder: 'Your eNom Login ID',
        required: true,
      },
      {
        key: 'pw',
        label: 'Password/API Token',
        type: 'password',
        placeholder: 'Your eNom password or API token',
        required: true,
      },
    ],
  };

  private parseXml(xmlText: string): any {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseNode = (node: Element): any => {
      const result: any = {};
      for (const child of Array.from(node.children)) {
        const childValue = child.children.length > 0 ? parseNode(child) : child.textContent?.trim() || '';
        result[child.tagName] = childValue;
      }
      return result;
    };

    return parseNode(xmlDoc.documentElement);
  }

  private async request(credentials: EnomCredentials, command: string, params: Record<string, string> = {}): Promise<any> {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'enom',
        credentials: {
          uid: credentials.uid,
          pw: credentials.pw,
        },
        command,
        params,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eNom API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`eNom API error: ${result.error}`);
    }

    // Le proxy retourne du XML brut, on le parse ici
    if (typeof result.data === 'string') {
      const data = this.parseXml(result.data);
      if (data.ErrCount && parseInt(data.ErrCount, 10) > 0) {
        throw new Error(`eNom API error: ${data.Err1 || 'Unknown'}`);
      }
      return data;
    }

    return result.data;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as EnomCredentials, 'GetDomains');
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    const data = await this.request(credentials as EnomCredentials, 'GetDomains');
    const domains: string[] = [];

    // eNom returns domains as domain-name1, domain-name2, etc.
    for (const key of Object.keys(data)) {
      if (key.match(/^domain-name\d+$/i) && data[key]) {
        domains.push(data[key]);
      }
    }

    return domains;
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const [sld, tld] = domain.split('.');
      const data = await this.request(credentials as EnomCredentials, 'GetDomainInfo', { sld, tld });

      return {
        domain_name: domain,
        expiry_date: data['expiration-date'] ? new Date(data['expiration-date']) : null,
        registration_date: data['registration-date'] ? new Date(data['registration-date']) : null,
        auto_renew: data['auto-renew'] === '1',
        registrar_name: 'eNom',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'eNom' };
    }
  }

  async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
    const domains = await this.getDomainList(credentials);
    const results: DomainInfo[] = [];

    for (const domain of domains) {
      results.push(await this.getDomainInfo(credentials, domain));
      await new Promise((r) => setTimeout(r, 200));
    }

    return results;
  }
}

export const enomProvider = new EnomProvider();
