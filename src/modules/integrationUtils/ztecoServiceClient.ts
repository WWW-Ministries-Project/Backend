import type { AxiosRequestConfig } from "axios";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

export const getZtecoServiceBaseUrl = (): string => {
  const baseUrl = String(process.env.ZTECO_SERVICE || "").trim();
  if (!baseUrl) {
    throw new Error("ZTECO_SERVICE is not configured");
  }

  return normalizeBaseUrl(baseUrl);
};

export const buildZtecoServiceHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  const token = String(process.env.ZTECO_SERVICE_TOKEN || "").trim();

  if (token) {
    headers["x-zteco-service-token"] = token;
  }

  return headers;
};

export const buildZtecoServiceRequestConfig = (): AxiosRequestConfig => {
  const headers = buildZtecoServiceHeaders();
  return Object.keys(headers).length ? { headers } : {};
};

export const getZtecoServiceUrl = (path: string): string => {
  const baseUrl = getZtecoServiceBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
};
