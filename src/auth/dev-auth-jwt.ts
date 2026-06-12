const DEV_AUTH_ISSUER = "https://praxisplaner.local/dev-auth";
const DEV_AUTH_AUDIENCE = "praxisplaner-dev";
const DEV_AUTH_KEY_ID = "praxisplaner-dev-auth-2026-06";

const DEV_AUTH_PRIVATE_KEY_PKCS8 =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7ChKEfmGbYCSaDfhTr3t/W/FOJhzB2NuXaulvBEBnGCsb7Dm2Uzwih6i1eG0aHsd+yDkjH2F3w5kI4bBC/prYsAo4xzZ1PtZiHVNzTDKZPBfXCWrNHMEfzp3hXre3JYv/mQC6wHWoLv7gkW5QsXRVqv8zTJBvBW/n4YOHVm558T87x6JOzxjBHoo0x9owuvigVS81WtYDSA8FRH7SwIiWTkVsp4EQoIIh62wBk0g0znPKMFqGrIBEOo80ulT/w3M7a67Q2nJvlg+7xk0raH3mEyHlxNoHUQaC4HboX/fSYqeaods8cVIAdkaI/htDGvPwsfAkSYa5s7imCd/sEx8TAgMBAAECggEALna3l+tvYvJU1WJgDKX8x2w3O0MzhKJTFr/r4nTLbPDvkJ2zzovJ1ggeTIpwi/sWcvPZYdTDWUWhaDfsmg/2tpqwx18Rs7ma9z+yweMtdKydfYFs4yxf+39P8DMf72Ln7uR67mmuMMwP7Aikv2396OQ0RnGgNbxDivaWPpIlmqv7LIqYuuQpkuxsA6ZNJroIE+DWL4BVnr+56ofQRKiDpPGMLhTiP8kTGOhRCnnOo3oKBH6wKSaoxm24qb/S5BQw2fM5oUFA+kT/QA4BNv2AXWKMwktAYFI5k8Wm0hmj5uzJmJGUzgkemjt1o+vO3fkcBuOhtAzq4MUJ0IYaZbn8WQKBgQDoy/6BiJc3jpEfwInc7shd5b95FoKpuwzXEstU0StUx0rZZwo8ligesux+40iTc3cUFs2N95unKj0hwWZIBIuDiEZoZpzBcAaGfLCKMU5I+1MtxEgtj2VhVWsU8vBuir0cA5dkL6jn3w3RYdoLHzKuD4mq+e5kTA+34S8OX+bleQKBgQDNromG1VC5hAk05VehhXsWOqswmZCN+eMi11BSw5vZWOOgG1Qg4DejMCurr03TV6vGNwjgg/ulG4341t0SAbwlyg4Ee7JiyPtfj3a6tsJvjghao+OEGlnr6+Boq0fE9eaWsZKp0GkVaP35dZUf1Cdj88vHN/KhtryMH/h/3MEB6wKBgCMCisPwRs2UIz8jNZiEUJ3Ob31GZWAhQU0XBn0698lIL3mChYeXDXGQdwCeLcv/EWl0BHXVRxNcxtTMwRUTmeeuFuichfaRYmnXVrVxtNRE971qR3CSoCyDLBd6ca4uL0KHR71JbZ1xbiKPFLuXdYe3znxoGfH7fmGo++qtgYwBAoGBAMjYcrsTemxtnn/kpBm5umQOjjQ7AIljRoUzM+Bd2sX2ovApP5GK4UmdNEfGO3zw03APNb/nocesjIo9Zkq7HvrXv7BpCdyk3bKG6S2SYXOFgmrgNr887CoQf2Y2OzL93FmytMDWHoclqzv5sdEO3hggbRDwdSGsy5kZbxOMgXxZAoGAMfnczvU+bpIpjGNtNoZP/7MqzvMDiGUll7j20s/RkAxs2pbYYxC7S9Kg6jIYOCMjlLwY8BQvCriP/9CyH+U6BdQIGPOM3ejBH5FvnySs5sHpcQe+vOSyarba1F76IH+LY1XRVzW3N9mwy4HKhvPgHg02xyuwlTGrPtG/QSZCAv4=";

const DEV_PERSONAS = {
  admin: {
    email: "admin@preview.test",
    permissions: ["regeln:read", "praxisplaner:read"],
    role: "admin",
    roles: ["admin"],
    subject: "dev-admin",
  },
  owner: {
    email: "owner@preview.test",
    permissions: ["regeln:read", "praxisplaner:read"],
    role: "owner",
    roles: ["owner"],
    subject: "dev-owner",
  },
  patient: {
    email: "patient@preview.test",
    permissions: [],
    role: null,
    roles: [],
    subject: "dev-patient",
  },
  staff: {
    email: "staff@preview.test",
    permissions: ["praxisplaner:read"],
    role: "staff",
    roles: ["staff"],
    subject: "dev-staff",
  },
} as const;

export type DevAuthPersona = keyof typeof DEV_PERSONAS;

let importedKeyPromise: null | Promise<CryptoKey> = null;

export async function createDevAuthJwt(
  persona: DevAuthPersona,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const details = DEV_PERSONAS[persona];
  const header = {
    alg: "RS256",
    kid: DEV_AUTH_KEY_ID,
    typ: "JWT",
  };
  const payload = {
    aud: DEV_AUTH_AUDIENCE,
    email: details.email,
    exp: now + 5 * 60,
    iat: now,
    iss: DEV_AUTH_ISSUER,
    permissions: details.permissions,
    role: details.role,
    roles: details.roles,
    sub: details.subject,
  };

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const key = await getImportedKey();
  const signature = await globalThis.crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

export function getDevAuthPersonaAccess(persona: DevAuthPersona): {
  permissions: readonly string[];
  role: null | string;
  roles: readonly string[];
} {
  const details = DEV_PERSONAS[persona];
  return {
    permissions: details.permissions,
    role: details.role,
    roles: details.roles,
  };
}

export function getDevAuthPersonaForPath(pathname: string): DevAuthPersona {
  const pathOnly = pathname.split("?", 1)[0]?.split("#", 1)[0] ?? pathname;
  if (pathOnly === "/") {
    return "owner";
  }
  const [, firstSegment, appSection] = pathOnly.split("/", 4);
  if (firstSegment === "account") {
    return "owner";
  }
  if (firstSegment === "regeln") {
    return "admin";
  }
  if (firstSegment === "praxisplaner") {
    return "staff";
  }
  if (appSection === "regeln") {
    return "admin";
  }
  if (appSection === "praxisplaner") {
    return "staff";
  }
  return "patient";
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

async function getImportedKey(): Promise<CryptoKey> {
  importedKeyPromise ??= globalThis.crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes(),
    {
      hash: "SHA-256",
      name: "RSASSA-PKCS1-v1_5",
    },
    false,
    ["sign"],
  );
  return await importedKeyPromise;
}

function pkcs8Bytes(): ArrayBuffer {
  const binary = atob(DEV_AUTH_PRIVATE_KEY_PKCS8);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
