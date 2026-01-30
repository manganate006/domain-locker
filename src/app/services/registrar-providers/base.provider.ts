/**
 * Base Provider Abstract Class
 *
 * Classe de base pour simplifier l'implémentation des providers.
 * Fournit les méthodes communes et la structure de base.
 */

import {
  RegistrarProvider,
  ProviderConfig,
  DomainInfo,
  ProviderCredentials,
} from './provider.interface';

/**
 * Options pour la requête API
 */
export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
}

/**
 * Classe de base abstraite pour les providers
 */
export abstract class BaseProvider implements RegistrarProvider {
  abstract readonly name: string;
  abstract readonly config: ProviderConfig;

  /**
   * URL de base de l'API
   */
  protected abstract readonly apiUrl: string;

  /**
   * Construit les headers d'authentification
   */
  protected abstract buildAuthHeaders(credentials: ProviderCredentials): Record<string, string>;

  /**
   * Effectue une requête HTTP générique
   */
  protected async httpRequest<T>(
    url: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', headers = {}, body, params } = options;

    let fullUrl = url;
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      fullUrl = `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
    };

    if (body) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(fullUrl, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Requête authentifiée vers l'API
   */
  protected async request<T>(
    credentials: ProviderCredentials,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const authHeaders = this.buildAuthHeaders(credentials);

    return this.httpRequest<T>(url, {
      ...options,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    });
  }

  /**
   * Parse une réponse XML en objet
   */
  protected parseXml(xmlText: string): any {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parseNode = (node: Element): any => {
      const result: any = {};

      // Attributs
      for (const attr of Array.from(node.attributes)) {
        result[`@${attr.name}`] = attr.value;
      }

      // Enfants
      for (const child of Array.from(node.children)) {
        const childValue =
          child.children.length > 0 ? parseNode(child) : child.textContent?.trim() || '';
        const tagName = child.tagName;

        if (result[tagName]) {
          if (!Array.isArray(result[tagName])) {
            result[tagName] = [result[tagName]];
          }
          result[tagName].push(childValue);
        } else {
          result[tagName] = childValue;
        }
      }

      // Texte si pas d'enfants
      if (node.children.length === 0) {
        const text = node.textContent?.trim();
        if (text && Object.keys(result).length === 0) {
          return text;
        }
        if (text) {
          result['#text'] = text;
        }
      }

      return result;
    };

    return parseNode(xmlDoc.documentElement);
  }

  /**
   * Pause pour respecter les rate limits
   */
  protected async rateLimitPause(ms: number = 100): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Crée un DomainInfo avec valeurs par défaut
   */
  protected createDomainInfo(partial: Partial<DomainInfo> & { domain_name: string }): DomainInfo {
    return {
      expiry_date: null,
      registration_date: null,
      dns_servers: [],
      registrar_name: this.config.displayName,
      ...partial,
    };
  }

  /**
   * Méthodes abstraites à implémenter
   */
  abstract validateCredentials(credentials: ProviderCredentials): Promise<boolean>;
  abstract getDomainList(credentials: ProviderCredentials): Promise<string[]>;
  abstract getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo>;
  abstract getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]>;
}

/**
 * Factory pour créer des providers simples basés sur JSON API
 */
export function createJsonApiProvider(config: {
  name: string;
  displayName: string;
  description: string;
  docsUrl: string;
  apiUrl: string;
  credentialFields: ProviderConfig['credentialFields'];
  buildAuthHeaders: (credentials: ProviderCredentials) => Record<string, string>;
  endpoints: {
    listDomains: string;
    getDomain?: (domain: string) => string;
  };
  parsers: {
    listDomains: (response: any) => string[];
    domainInfo: (response: any, domain: string) => DomainInfo;
  };
  validatePath?: string;
}): RegistrarProvider {
  return {
    name: config.name,
    config: {
      name: config.name,
      displayName: config.displayName,
      description: config.description,
      docsUrl: config.docsUrl,
      credentialFields: config.credentialFields,
    },

    async validateCredentials(credentials: ProviderCredentials): Promise<boolean> {
      try {
        const url = `${config.apiUrl}${config.validatePath || config.endpoints.listDomains}`;
        const response = await fetch(url, {
          headers: config.buildAuthHeaders(credentials),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async getDomainList(credentials: ProviderCredentials): Promise<string[]> {
      const url = `${config.apiUrl}${config.endpoints.listDomains}`;
      const response = await fetch(url, {
        headers: config.buildAuthHeaders(credentials),
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      return config.parsers.listDomains(data);
    },

    async getDomainInfo(credentials: ProviderCredentials, domain: string): Promise<DomainInfo> {
      if (!config.endpoints.getDomain) {
        // Fallback: chercher dans la liste complète
        const allDomains = await this.getAllDomainsInfo(credentials);
        return allDomains.find((d) => d.domain_name === domain) || {
          domain_name: domain,
          expiry_date: null,
          registrar_name: config.displayName,
        };
      }

      const url = `${config.apiUrl}${config.endpoints.getDomain(domain)}`;
      const response = await fetch(url, {
        headers: config.buildAuthHeaders(credentials),
      });
      if (!response.ok) {
        return { domain_name: domain, expiry_date: null, registrar_name: config.displayName };
      }
      const data = await response.json();
      return config.parsers.domainInfo(data, domain);
    },

    async getAllDomainsInfo(credentials: ProviderCredentials): Promise<DomainInfo[]> {
      const domains = await this.getDomainList(credentials);
      const results: DomainInfo[] = [];

      for (const domain of domains) {
        const info = await this.getDomainInfo(credentials, domain);
        results.push(info);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return results;
    },
  };
}
