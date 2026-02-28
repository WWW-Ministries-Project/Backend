import crypto from "crypto";

const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export class AiCredentialCryptoError extends Error {
  status_code: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "AiCredentialCryptoError";
    this.status_code = statusCode;
  }
}

export class AiCredentialCrypto {
  private encryptionKey: Buffer | null = null;

  encrypt(plainText: string): string {
    if (!plainText || !plainText.trim()) {
      throw new AiCredentialCryptoError("Credential value is required", 400);
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, this.getEncryptionKey(), iv);
    const encryptedBuffer = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString("base64"),
      authTag.toString("base64"),
      encryptedBuffer.toString("base64"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const parts = String(payload || "").split(".");
    if (parts.length !== 3) {
      throw new AiCredentialCryptoError("Invalid encrypted credential payload");
    }

    const [ivBase64, authTagBase64, cipherTextBase64] = parts;
    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");
    const cipherText = Buffer.from(cipherTextBase64, "base64");

    const decipher = crypto.createDecipheriv(AES_ALGORITHM, this.getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString("utf8");
  }

  private resolveEncryptionKey(): Buffer {
    const raw = String(process.env.AI_CREDENTIAL_ENCRYPTION_KEY || "").trim();
    if (!raw) {
      throw new AiCredentialCryptoError(
        "AI_CREDENTIAL_ENCRYPTION_KEY is not configured",
      );
    }

    if (/^[a-fA-F0-9]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }

    const base64Buffer = Buffer.from(raw, "base64");
    if (base64Buffer.length === 32) {
      return base64Buffer;
    }

    return crypto.createHash("sha256").update(raw).digest();
  }

  private getEncryptionKey(): Buffer {
    if (!this.encryptionKey) {
      this.encryptionKey = this.resolveEncryptionKey();
    }
    return this.encryptionKey;
  }
}
