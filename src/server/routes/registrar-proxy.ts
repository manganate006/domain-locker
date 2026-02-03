/**
 * Registrar API Proxy
 *
 * Route backend qui fait les appels vers les APIs des registrars.
 * Cela contourne les restrictions CORS car les appels sont faits
 * depuis le serveur (pas le navigateur).
 *
 * Endpoints supportés :
 * - POST /api/registrar-proxy
 *   Body: { provider, endpoint, method, path, body?, credentials }
 */

import { defineEventHandler, readBody, createError, sendError } from 'h3';
import * as crypto from 'crypto';

/**
 * Endpoints API OVH selon la région
 */
const OVH_ENDPOINTS: Record<string, string> = {
  'ovh-eu': 'https://eu.api.ovh.com/1.0',
  'ovh-ca': 'https://ca.api.ovh.com/1.0',
  'ovh-us': 'https://api.us.ovhcloud.com/1.0',
  'kimsufi-eu': 'https://eu.api.kimsufi.com/1.0',
  'kimsufi-ca': 'https://ca.api.kimsufi.com/1.0',
  'soyoustart-eu': 'https://eu.api.soyoustart.com/1.0',
  'soyoustart-ca': 'https://ca.api.soyoustart.com/1.0',
};

/**
 * Génère la signature HMAC pour OVH
 */
function generateOvhSignature(
  appSecret: string,
  consumerKey: string,
  method: string,
  url: string,
  body: string,
  timestamp: number
): string {
  const toSign = `${appSecret}+${consumerKey}+${method}+${url}+${body}+${timestamp}`;
  const hash = crypto.createHash('sha1').update(toSign).digest('hex');
  return `$1$${hash}`;
}

/**
 * Récupère le timestamp du serveur OVH
 */
async function getOvhServerTimestamp(baseUrl: string): Promise<number> {
  try {
    const response = await fetch(`${baseUrl}/auth/time`);
    if (!response.ok) {
      return Math.floor(Date.now() / 1000);
    }
    return await response.json();
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Proxy pour les appels API OVH
 */
async function proxyOvhRequest(
  credentials: {
    applicationKey: string;
    applicationSecret: string;
    consumerKey: string;
    endpoint?: string;
  },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  const endpoint = credentials.endpoint || 'ovh-eu';
  const baseUrl = OVH_ENDPOINTS[endpoint] || OVH_ENDPOINTS['ovh-eu'];
  const url = `${baseUrl}${path}`;

  const timestamp = await getOvhServerTimestamp(baseUrl);
  const signature = generateOvhSignature(
    credentials.applicationSecret,
    credentials.consumerKey,
    method,
    url,
    body,
    timestamp
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Ovh-Application': credentials.applicationKey,
    'X-Ovh-Timestamp': timestamp.toString(),
    'X-Ovh-Signature': signature,
    'X-Ovh-Consumer': credentials.consumerKey,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API Hostinger
 */
async function proxyHostingerRequest(
  credentials: { apiKey: string },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  // URL officielle de l'API Hostinger (pas api.hostinger.com qui n'existe pas)
  // Voir: https://developers.hostinger.com/
  const baseUrl = 'https://developers.hostinger.com/api';
  const url = `${baseUrl}${path}`;

  console.log(`[registrar-proxy] Hostinger ${method} ${url}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${credentials.apiKey}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  console.log(`[registrar-proxy] Hostinger response status: ${response.status}`);

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  // Log la réponse pour debug (tronquée à 1000 caractères)
  const dataStr = JSON.stringify(parsedData);
  console.log(`[registrar-proxy] Hostinger response body (${dataStr.length} chars):`, dataStr.slice(0, 1000));

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API GoDaddy
 */
async function proxyGodaddyRequest(
  credentials: { apiKey: string; apiSecret: string; environment?: string },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  const isProd = credentials.environment === 'production';
  const baseUrl = isProd
    ? 'https://api.godaddy.com/v1'
    : 'https://api.ote-godaddy.com/v1';
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `sso-key ${credentials.apiKey}:${credentials.apiSecret}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API Cloudflare
 * Supporte l'authentification par API Token ou Email + API Key
 */
async function proxyCloudflareRequest(
  credentials: { apiToken?: string; email?: string; apiKey?: string },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.cloudflare.com/client/v4';
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Support both authentication methods
  if (credentials.apiToken) {
    headers['Authorization'] = `Bearer ${credentials.apiToken}`;
  } else if (credentials.email && credentials.apiKey) {
    headers['X-Auth-Email'] = credentials.email;
    headers['X-Auth-Key'] = credentials.apiKey;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API Namecheap
 * Supporte deux formats :
 * - { command, params } pour le nouveau format
 * - { method, path } pour l'ancien format
 */
async function proxyNamecheapRequest(
  credentials: { apiUser: string; apiKey: string; username: string; clientIp: string; sandbox?: boolean },
  command: string,
  extraParams: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = credentials.sandbox
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';

  // Namecheap utilise des paramètres GET
  const params = new URLSearchParams({
    ApiUser: credentials.apiUser,
    ApiKey: credentials.apiKey,
    UserName: credentials.username,
    ClientIp: credentials.clientIp,
    Command: command,
    ...extraParams,
  });

  const url = `${baseUrl}?${params.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  return {
    status: response.status,
    data: responseData, // XML response - le parsing sera fait côté client
  };
}

/**
 * Proxy pour les appels API Name.com
 */
async function proxyNamecomRequest(
  credentials: { username: string; apiToken: string },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.name.com/v4';
  const url = `${baseUrl}${path}`;

  const auth = Buffer.from(`${credentials.username}:${credentials.apiToken}`).toString('base64');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${auth}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API Gandi
 */
async function proxyGandiRequest(
  credentials: { apiKey: string },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.gandi.net/v5';
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Apikey ${credentials.apiKey}`,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API NameSilo
 */
async function proxyNamesiloRequest(
  credentials: { apiKey: string },
  operation: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://www.namesilo.com/api';

  const queryParams = new URLSearchParams({
    version: '1',
    type: 'xml',
    key: credentials.apiKey,
    ...params,
  });

  const url = `${baseUrl}/${operation}?${queryParams.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  return {
    status: response.status,
    data: responseData, // XML response - parsing côté client
  };
}

/**
 * Proxy pour les appels API Dynadot
 */
async function proxyDynadotRequest(
  credentials: { apiKey: string },
  command: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.dynadot.com/api3.json';

  const queryParams = new URLSearchParams({
    key: credentials.apiKey,
    command,
    ...params,
  });

  const url = `${baseUrl}?${queryParams.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API Porkbun
 */
async function proxyPorkbunRequest(
  credentials: { apiKey: string; secretKey: string },
  method: string,
  path: string,
  body: string = ''
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.porkbun.com/api/json/v3';
  const url = `${baseUrl}${path}`;

  // Porkbun requires API keys in the body
  let requestBody: Record<string, unknown> = {
    apikey: credentials.apiKey,
    secretapikey: credentials.secretKey,
  };

  if (body) {
    try {
      const parsedBody = JSON.parse(body);
      requestBody = { ...requestBody, ...parsedBody };
    } catch {
      // Keep just the credentials
    }
  }

  const response = await fetch(url, {
    method: 'POST', // Porkbun always uses POST
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const responseData = await response.text();
  let parsedData: unknown;

  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API DreamHost
 */
async function proxyDreamhostRequest(
  credentials: { apiKey: string },
  cmd: string
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.dreamhost.com';
  const params = new URLSearchParams({
    key: credentials.apiKey,
    cmd,
    format: 'json',
  });

  const url = `${baseUrl}/?${params.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API eNom
 */
async function proxyEnomRequest(
  credentials: { uid: string; pw: string },
  command: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://reseller.enom.com/interface.asp';

  const queryParams = new URLSearchParams({
    uid: credentials.uid,
    pw: credentials.pw,
    command,
    responsetype: 'xml',
    ...params,
  });

  const url = `${baseUrl}?${queryParams.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  return {
    status: response.status,
    data: responseData, // XML response - parsing côté client
  };
}

/**
 * Proxy pour les appels API Internet.bs
 */
async function proxyInternetbsRequest(
  credentials: { apiKey: string; password: string },
  endpoint: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.internet.bs';

  const queryParams = new URLSearchParams({
    ApiKey: credentials.apiKey,
    Password: credentials.password,
    ResponseFormat: 'JSON',
    ...params,
  });

  const url = `${baseUrl}${endpoint}?${queryParams.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API NameBright
 */
async function proxyNamebrightRequest(
  credentials: { apiKey: string; apiSecret: string },
  method: string,
  path: string
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.namebright.com/rest';
  const url = `${baseUrl}${path}`;

  const auth = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${auth}`,
  };

  const response = await fetch(url, { method, headers });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API OpenSRS
 */
async function proxyOpensrsRequest(
  credentials: { username: string; apiKey: string },
  action: string,
  object: string,
  attributes: Record<string, any> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://rr-n1-tor.opensrs.net:55443';

  // Build XML request
  const attrsXml = Object.entries(attributes)
    .map(([key, value]) => `<item key="${key}">${value}</item>`)
    .join('');

  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='no' ?>
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

  // Generate signature
  const md5_1 = crypto.createHash('md5').update(xml + credentials.apiKey).digest('hex');
  const signature = crypto.createHash('md5').update(md5_1 + credentials.apiKey).digest('hex');

  const headers: Record<string, string> = {
    'Content-Type': 'text/xml',
    'X-Username': credentials.username,
    'X-Signature': signature,
  };

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: xml,
  });

  const responseData = await response.text();

  return {
    status: response.status,
    data: responseData, // XML response
  };
}

/**
 * Proxy pour les appels API ResellerClub
 */
async function proxyResellerclubRequest(
  credentials: { resellerId: string; apiKey: string },
  endpoint: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://httpapi.com/api';

  const queryParams = new URLSearchParams({
    'auth-userid': credentials.resellerId,
    'api-key': credentials.apiKey,
    ...params,
  });

  const url = `${baseUrl}${endpoint}?${queryParams.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API DNSimple
 */
async function proxyDnsimpleRequest(
  credentials: { accountId: string; apiToken: string },
  method: string,
  path: string
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://api.dnsimple.com/v2';
  const url = `${baseUrl}/${credentials.accountId}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.apiToken}`,
    Accept: 'application/json',
  };

  const response = await fetch(url, { method, headers });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Proxy pour les appels API Above.com
 */
async function proxyAbovecomRequest(
  credentials: { apiKey: string },
  endpoint: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = 'https://www.above.com/api';

  const queryParams = new URLSearchParams({
    key: credentials.apiKey,
    ...params,
  });

  const url = `${baseUrl}${endpoint}?${queryParams.toString()}`;

  const response = await fetch(url, { method: 'GET' });
  const responseData = await response.text();

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(responseData);
  } catch {
    parsedData = responseData;
  }

  return {
    status: response.status,
    data: parsedData,
  };
}

/**
 * Handler principal du proxy
 */
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);

    if (!body) {
      return sendError(
        event,
        createError({
          statusCode: 400,
          statusMessage: 'Request body is required',
        })
      );
    }

    // Support both formats: direct { method, path } and nested { request: { method, path } }
    const request = body.request || {};
    const { provider, credentials, command, params } = body;
    const method = body.method || request.method || 'GET';
    const path = body.path || request.path;
    const requestBody = body.body || request.body;

    if (!provider) {
      return sendError(
        event,
        createError({
          statusCode: 400,
          statusMessage: 'Provider is required',
        })
      );
    }

    // Path is required for most providers, but Namecheap uses command instead
    if (!path && !command) {
      return sendError(
        event,
        createError({
          statusCode: 400,
          statusMessage: 'Path or command is required',
        })
      );
    }

    if (!credentials) {
      return sendError(
        event,
        createError({
          statusCode: 400,
          statusMessage: 'Credentials are required',
        })
      );
    }

    let result: { status: number; data: unknown };

    switch (provider.toLowerCase()) {
      case 'ovh':
        result = await proxyOvhRequest(credentials, method, path, requestBody);
        break;

      case 'hostinger':
        result = await proxyHostingerRequest(credentials, method, path, requestBody);
        break;

      case 'godaddy':
        result = await proxyGodaddyRequest(credentials, method, path, requestBody);
        break;

      case 'cloudflare':
        result = await proxyCloudflareRequest(credentials, method, path, requestBody);
        break;

      case 'namecheap':
        result = await proxyNamecheapRequest(credentials, command || path, params || {});
        break;

      case 'namecom':
        result = await proxyNamecomRequest(credentials, method, path, requestBody);
        break;

      case 'gandi':
        result = await proxyGandiRequest(credentials, method, path, requestBody);
        break;

      case 'porkbun':
        result = await proxyPorkbunRequest(credentials, method, path, requestBody);
        break;

      case 'namesilo':
        result = await proxyNamesiloRequest(credentials, body.operation || path, body.params || {});
        break;

      case 'dynadot':
        result = await proxyDynadotRequest(credentials, command || body.command, body.params || {});
        break;

      case 'dreamhost':
        result = await proxyDreamhostRequest(credentials, command || body.command);
        break;

      case 'enom':
        result = await proxyEnomRequest(credentials, command || body.command, body.params || {});
        break;

      case 'internetbs':
        result = await proxyInternetbsRequest(credentials, path, body.params || {});
        break;

      case 'namebright':
        result = await proxyNamebrightRequest(credentials, method, path);
        break;

      case 'opensrs':
        result = await proxyOpensrsRequest(credentials, body.action, body.object, body.attributes || {});
        break;

      case 'resellerclub':
        result = await proxyResellerclubRequest(credentials, path, body.params || {});
        break;

      case 'dnsimple':
        result = await proxyDnsimpleRequest(credentials, method, path);
        break;

      case 'abovecom':
        result = await proxyAbovecomRequest(credentials, path, body.params || {});
        break;

      default:
        return sendError(
          event,
          createError({
            statusCode: 400,
            statusMessage: `Unknown provider: ${provider}`,
          })
        );
    }

    // Return the proxied response
    if (result.status >= 400) {
      return {
        statusCode: result.status,
        body: {
          error: true,
          data: result.data,
        },
      };
    }

    return {
      success: true,
      data: result.data,
    };
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[registrar-proxy] Error:', error.message);

    return sendError(
      event,
      createError({
        statusCode: 500,
        statusMessage: 'Registrar API proxy failed',
        data: { error: error.message },
      })
    );
  }
});
