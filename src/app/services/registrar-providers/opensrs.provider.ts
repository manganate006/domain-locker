/**
 * OpenSRS Registrar Provider
 *
 * Documentation API : https://domains.opensrs.guide/docs
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';
import * as crypto from 'crypto';

export interface OpenSrsCredentials extends ProviderCredentials {
  username: string;
  apiKey: string;
}

const OPENSRS_API_URL = 'https://rr-n1-tor.opensrs.net:55443';

export class OpenSrsProvider implements RegistrarProvider {
  readonly name = 'opensrs';

  readonly config: ProviderConfig = {
    name: 'opensrs',
    displayName: 'OpenSRS',
    description: 'Import domains from your OpenSRS reseller account',
    docsUrl: 'https://domains.opensrs.guide/docs',
    credentialFields: [
      {
        key: 'username',
        label: 'Reseller Username',
        type: 'text',
        placeholder: 'Your OpenSRS username',
        required: true,
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Your OpenSRS API Key',
        helpText: 'Private key from Reseller Control Panel',
        required: true,
      },
    ],
  };

  private generateSignature(xml: string, apiKey: string): string {
    const md5_1 = crypto.createHash('md5').update(xml + apiKey).digest('hex');
    return crypto.createHash('md5').update(md5_1 + apiKey).digest('hex');
  }

  private buildXmlRequest(action: string, object: string, attributes: Record<string, any>): string {
    const attrsXml = Object.entries(attributes)
      .map(([key, value]) => `<item key="${key}">${value}</item>`)
      .join('');

    return `<?xml version='1.0' encoding='UTF-8' standalone='no' ?>
<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>
<OPS_envelope>
  <header><version>0.9</version></header>
  <body>
    <data_block>
      <dt_assoc>
        <item key="protocol">XCP</item>
        <item key="action">${action}</item>
        <item key="object">${object}</item>
        <item key="attributes">
          <dt_assoc>${attrsXml}</dt_assoc>
        </item>
      </dt_assoc>
    </data_block>
  </body>
</OPS_envelope>`;
  }

  private async request(credentials: OpenSrsCredentials, action: string, object: string, attributes: Record<string, any> = {}): Promise<any> {
    const xml = this.buildXmlRequest(action, object, attributes);
    const signature = this.generateSignature(xml, credentials.apiKey);

    const response = await fetch(OPENSRS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-Username': credentials.username,
        'X-Signature': signature,
      },
      body: xml,
    });

    if (!response.ok) throw new Error(`OpenSRS API error: ${response.status}`);

    const text = await response.text();
    // Simple XML parsing for OpenSRS response
    const isSuccess = text.includes('<item key="is_success">1</item>');
    if (!isSuccess && !text.includes('attributes')) {
      throw new Error('OpenSRS API error: Request failed');
    }

    return text;
  }

  async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
    try {
      await this.request(credentials as OpenSrsCredentials, 'GET_DOMAINS_BY_EXPIREDATE', 'DOMAIN', {
        exp_from: new Date().toISOString().split('T')[0],
        exp_to: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        limit: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
    // OpenSRS requires date range for domain listing
    const today = new Date();
    const futureDate = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000); // 10 years

    const xml = await this.request(credentials as OpenSrsCredentials, 'GET_DOMAINS_BY_EXPIREDATE', 'DOMAIN', {
      exp_from: today.toISOString().split('T')[0],
      exp_to: futureDate.toISOString().split('T')[0],
      limit: 1000,
    });

    // Extract domain names from XML response
    const domainMatches = xml.match(/<item key="name">([^<]+)<\/item>/g) || [];
    return domainMatches.map((m: string) => m.replace(/<item key="name">|<\/item>/g, ''));
  }

  async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
    try {
      const xml = await this.request(credentials as OpenSrsCredentials, 'GET', 'DOMAIN', {
        domain,
        type: 'all_info',
      });

      // Parse expiry date
      const expiryMatch = xml.match(/<item key="expiredate">([^<]+)<\/item>/);
      const expiry = expiryMatch ? new Date(expiryMatch[1]) : null;

      // Parse auto-renew
      const autoRenewMatch = xml.match(/<item key="auto_renew">([^<]+)<\/item>/);
      const autoRenew = autoRenewMatch ? autoRenewMatch[1] === '1' : false;

      return {
        domain_name: domain,
        expiry_date: expiry,
        auto_renew: autoRenew,
        registrar_name: 'OpenSRS',
      };
    } catch {
      return { domain_name: domain, expiry_date: null, registrar_name: 'OpenSRS' };
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

export const opensrsProvider = new OpenSrsProvider();
