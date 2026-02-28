import { prisma } from "../../Models/context";
import { AiCredentialCrypto, AiCredentialCryptoError } from "./aiCredentialCrypto";

const SUPPORTED_PROVIDERS = new Set(["openai", "gemini"]);

type CredentialProvider = "openai" | "gemini";

type CreateCredentialPayload = {
  provider: string;
  api_key: string;
  api_secret?: string | null;
  is_active?: boolean;
};

type UpdateCredentialPayload = {
  api_key?: string;
  api_secret?: string | null;
  is_active?: boolean;
};

export class AiCredentialServiceError extends Error {
  status_code: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AiCredentialServiceError";
    this.status_code = statusCode;
  }
}

export class AiCredentialService {
  private crypto = new AiCredentialCrypto();

  async createCredential(actorId: number, payload: CreateCredentialPayload) {
    const provider = this.normalizeProvider(payload.provider);
    const apiKey = String(payload.api_key || "").trim();
    if (!apiKey) {
      throw new AiCredentialServiceError("api_key is required", 400);
    }

    const encryptedKey = this.encryptValue(apiKey);
    const encryptedSecret =
      payload.api_secret === undefined
        ? null
        : payload.api_secret === null
          ? null
          : this.encryptValue(String(payload.api_secret));
    const activate = payload.is_active === undefined ? true : Boolean(payload.is_active);
    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      if (activate) {
        await tx.ai_provider_credential.updateMany({
          where: { provider, is_active: true },
          data: { is_active: false },
        });
      }

      return tx.ai_provider_credential.create({
        data: {
          provider,
          encrypted_key: encryptedKey,
          encrypted_secret: encryptedSecret,
          is_active: activate,
          created_by: actorId,
          rotated_at: now,
        },
      });
    });

    return this.toSafeCredential(created);
  }

  async updateCredential(id: string, payload: UpdateCredentialPayload) {
    const credentialId = String(id || "").trim();
    if (!credentialId) {
      throw new AiCredentialServiceError("Credential id is required", 400);
    }

    const existing = await prisma.ai_provider_credential.findUnique({
      where: { id: credentialId },
    });
    if (!existing) {
      throw new AiCredentialServiceError("Credential not found", 404);
    }

    const updateData: {
      encrypted_key?: string;
      encrypted_secret?: string | null;
      is_active?: boolean;
      rotated_at?: Date;
    } = {};

    let shouldRotate = false;

    if (payload.api_key !== undefined) {
      const nextApiKey = String(payload.api_key || "").trim();
      if (!nextApiKey) {
        throw new AiCredentialServiceError("api_key cannot be empty", 400);
      }
      updateData.encrypted_key = this.encryptValue(nextApiKey);
      shouldRotate = true;
    }

    if (payload.api_secret !== undefined) {
      if (payload.api_secret === null || payload.api_secret === "") {
        updateData.encrypted_secret = null;
      } else {
        updateData.encrypted_secret = this.encryptValue(String(payload.api_secret));
      }
      shouldRotate = true;
    }

    if (payload.is_active !== undefined) {
      updateData.is_active = Boolean(payload.is_active);
      if (Boolean(payload.is_active)) {
        shouldRotate = true;
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new AiCredentialServiceError(
        "Provide at least one field to update",
        400,
      );
    }

    if (shouldRotate) {
      updateData.rotated_at = new Date();
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (updateData.is_active) {
        await tx.ai_provider_credential.updateMany({
          where: {
            provider: existing.provider,
            is_active: true,
            id: { not: existing.id },
          },
          data: { is_active: false },
        });
      }

      return tx.ai_provider_credential.update({
        where: { id: existing.id },
        data: updateData,
      });
    });

    return this.toSafeCredential(updated);
  }

  async listCredentials(provider?: string) {
    let normalizedProvider: CredentialProvider | undefined;
    if (provider !== undefined) {
      normalizedProvider = this.normalizeProvider(provider);
    }

    const credentials = await prisma.ai_provider_credential.findMany({
      where: normalizedProvider ? { provider: normalizedProvider } : undefined,
      orderBy: { created_at: "desc" },
    });

    return credentials.map((item) => this.toSafeCredential(item));
  }

  async getActiveCredential(providerInput: string) {
    const provider = this.normalizeProvider(providerInput);
    const credential = await prisma.ai_provider_credential.findFirst({
      where: {
        provider,
        is_active: true,
      },
      orderBy: {
        updated_at: "desc",
      },
    });

    if (!credential) {
      throw new AiCredentialServiceError(
        `No active ${provider} credentials configured`,
        500,
      );
    }

    try {
      return {
        id: credential.id,
        provider,
        api_key: this.crypto.decrypt(credential.encrypted_key),
        api_secret: credential.encrypted_secret
          ? this.crypto.decrypt(credential.encrypted_secret)
          : null,
      };
    } catch (error) {
      if (error instanceof AiCredentialCryptoError) {
        throw new AiCredentialServiceError(error.message, error.status_code);
      }
      throw error;
    }
  }

  private normalizeProvider(provider: string): CredentialProvider {
    const normalized = String(provider || "").trim().toLowerCase();
    if (!SUPPORTED_PROVIDERS.has(normalized)) {
      throw new AiCredentialServiceError(
        "provider must be one of: openai, gemini",
        400,
      );
    }
    return normalized as CredentialProvider;
  }

  private toSafeCredential(credential: {
    id: string;
    provider: string;
    encrypted_secret: string | null;
    is_active: boolean;
    created_by: number;
    rotated_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }) {
    return {
      id: credential.id,
      provider: credential.provider,
      is_active: credential.is_active,
      has_secret: Boolean(credential.encrypted_secret),
      created_by: credential.created_by,
      rotated_at: credential.rotated_at ? credential.rotated_at.toISOString() : null,
      created_at: credential.created_at.toISOString(),
      updated_at: credential.updated_at.toISOString(),
    };
  }

  private encryptValue(value: string): string {
    try {
      return this.crypto.encrypt(value);
    } catch (error: any) {
      if (error instanceof AiCredentialCryptoError) {
        throw new AiCredentialServiceError(error.message, error.status_code);
      }
      throw error;
    }
  }
}
