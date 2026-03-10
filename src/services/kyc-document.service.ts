import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('kyc-document');

// ─── Types ──────────────────────────────────────────────

export type DocumentType = 'cedula_frontal' | 'cedula_reverso' | 'selfie' | 'comprobante_domicilio' | 'certificado_actividades';
export type VerificationStatus = 'pending' | 'reviewing' | 'approved' | 'rejected' | 'expired';
export type KycTier = 'BASIC' | 'INTERMEDIATE' | 'FULL';

export interface KycDocument {
  id: string;
  userId: string;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  fileSize: number;         // bytes
  storageUrl: string;       // GCS path or placeholder
  status: VerificationStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
  expiresAt: string | null;
}

export interface KycVerification {
  id: string;
  userId: string;
  targetTier: KycTier;
  documents: string[];       // doc IDs
  status: VerificationStatus;
  notes: string | null;
  reviewedBy: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface KycRequirement {
  tier: KycTier;
  requiredDocuments: DocumentType[];
  description: string;
}

const DOC_PREFIX = 'kyc:doc:';
const USER_DOCS = 'kyc:user-docs:';
const VERIFICATION_PREFIX = 'kyc:verification:';
const USER_VERIFICATIONS = 'kyc:user-verifications:';
const KYC_TTL = 365 * 24 * 60 * 60;  // 1 year

const VALID_DOCUMENT_TYPES: DocumentType[] = [
  'cedula_frontal', 'cedula_reverso', 'selfie',
  'comprobante_domicilio', 'certificado_actividades',
];

const VALID_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10 MB

const TIER_REQUIREMENTS: KycRequirement[] = [
  {
    tier: 'BASIC',
    requiredDocuments: [],
    description: 'Registro con número de teléfono',
  },
  {
    tier: 'INTERMEDIATE',
    requiredDocuments: ['cedula_frontal', 'cedula_reverso', 'selfie'],
    description: 'Verificación de identidad con cédula y selfie',
  },
  {
    tier: 'FULL',
    requiredDocuments: [
      'cedula_frontal', 'cedula_reverso', 'selfie',
      'comprobante_domicilio', 'certificado_actividades',
    ],
    description: 'Verificación completa con documentos adicionales',
  },
];

// ─── Service ────────────────────────────────────────────

export class KycDocumentService {
  /**
   * Upload a KYC document.
   */
  async uploadDocument(input: {
    userId: string;
    type: DocumentType;
    fileName: string;
    mimeType: string;
    fileSize: number;
    storageUrl: string;
  }): Promise<KycDocument> {
    if (!input.userId) throw new Error('userId requerido');
    if (!VALID_DOCUMENT_TYPES.includes(input.type)) {
      throw new Error(`Tipo de documento inválido: ${input.type}`);
    }
    if (!input.fileName || input.fileName.length > 255) {
      throw new Error('Nombre de archivo inválido');
    }
    if (!VALID_MIME_TYPES.includes(input.mimeType)) {
      throw new Error(`Tipo MIME no soportado: ${input.mimeType}`);
    }
    if (input.fileSize <= 0 || input.fileSize > MAX_FILE_SIZE) {
      throw new Error(`Tamaño de archivo inválido (máx ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }
    if (!input.storageUrl) throw new Error('URL de almacenamiento requerida');

    const doc: KycDocument = {
      id: `doc_${randomBytes(8).toString('hex')}`,
      userId: input.userId,
      type: input.type,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      storageUrl: input.storageUrl,
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      uploadedAt: new Date().toISOString(),
      reviewedAt: null,
      expiresAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${DOC_PREFIX}${doc.id}`, JSON.stringify(doc), { EX: KYC_TTL });

      // Add to user's document list
      const listKey = `${USER_DOCS}${input.userId}`;
      const listRaw = await redis.get(listKey);
      const list: string[] = listRaw ? JSON.parse(listRaw) : [];
      list.push(doc.id);
      await redis.set(listKey, JSON.stringify(list), { EX: KYC_TTL });

      log.info('Document uploaded', { id: doc.id, userId: input.userId, type: input.type });
    } catch (err) {
      log.warn('Failed to save document', { error: (err as Error).message });
    }

    return doc;
  }

  /**
   * Get a document by ID.
   */
  async getDocument(docId: string): Promise<KycDocument | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${DOC_PREFIX}${docId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all documents for a user.
   */
  async getUserDocuments(userId: string): Promise<KycDocument[]> {
    try {
      const redis = getRedis();
      const listRaw = await redis.get(`${USER_DOCS}${userId}`);
      if (!listRaw) return [];

      const ids: string[] = JSON.parse(listRaw);
      const docs: KycDocument[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${DOC_PREFIX}${id}`);
        if (raw) docs.push(JSON.parse(raw));
      }

      return docs;
    } catch {
      return [];
    }
  }

  /**
   * Review a document (approve or reject).
   */
  async reviewDocument(
    docId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    rejectionReason?: string,
  ): Promise<KycDocument | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${DOC_PREFIX}${docId}`);
      if (!raw) return null;

      const doc: KycDocument = JSON.parse(raw);
      if (doc.status !== 'pending' && doc.status !== 'reviewing') {
        throw new Error(`No se puede revisar documento en estado ${doc.status}`);
      }

      doc.status = decision;
      doc.reviewedBy = reviewerId;
      doc.reviewedAt = new Date().toISOString();

      if (decision === 'rejected') {
        doc.rejectionReason = rejectionReason ?? 'Documento rechazado';
      }

      if (decision === 'approved') {
        // Set expiry to 2 years from now
        const expiry = new Date();
        expiry.setFullYear(expiry.getFullYear() + 2);
        doc.expiresAt = expiry.toISOString();
      }

      await redis.set(`${DOC_PREFIX}${docId}`, JSON.stringify(doc), { EX: KYC_TTL });
      log.info('Document reviewed', { id: docId, decision, reviewerId });
      return doc;
    } catch (err) {
      if ((err as Error).message.includes('No se puede')) throw err;
      return null;
    }
  }

  /**
   * Start a KYC verification process.
   */
  async startVerification(
    userId: string,
    targetTier: KycTier,
  ): Promise<KycVerification> {
    if (targetTier === 'BASIC') {
      throw new Error('No se requiere verificación para tier BASIC');
    }

    const requirement = TIER_REQUIREMENTS.find((r) => r.tier === targetTier);
    if (!requirement) throw new Error(`Tier inválido: ${targetTier}`);

    // Check user has required documents
    const userDocs = await this.getUserDocuments(userId);
    const approvedTypes = userDocs
      .filter((d) => d.status === 'approved')
      .map((d) => d.type);

    const missing = requirement.requiredDocuments.filter(
      (req) => !approvedTypes.includes(req),
    );

    // Find document IDs for required types (prefer approved)
    const docIds: string[] = [];
    for (const reqType of requirement.requiredDocuments) {
      const doc = userDocs.find((d) => d.type === reqType && d.status === 'approved')
        || userDocs.find((d) => d.type === reqType && d.status === 'pending');
      if (doc) docIds.push(doc.id);
    }

    const verification: KycVerification = {
      id: `kyv_${randomBytes(8).toString('hex')}`,
      userId,
      targetTier,
      documents: docIds,
      status: missing.length === 0 ? 'reviewing' : 'pending',
      notes: missing.length > 0
        ? `Documentos faltantes: ${missing.join(', ')}`
        : null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(
        `${VERIFICATION_PREFIX}${verification.id}`,
        JSON.stringify(verification),
        { EX: KYC_TTL },
      );

      // Add to user's verification list
      const listKey = `${USER_VERIFICATIONS}${userId}`;
      const listRaw = await redis.get(listKey);
      const list: string[] = listRaw ? JSON.parse(listRaw) : [];
      list.push(verification.id);
      await redis.set(listKey, JSON.stringify(list), { EX: KYC_TTL });

      log.info('Verification started', {
        id: verification.id, userId, targetTier, missing: missing.length,
      });
    } catch (err) {
      log.warn('Failed to save verification', { error: (err as Error).message });
    }

    return verification;
  }

  /**
   * Get a verification by ID.
   */
  async getVerification(verificationId: string): Promise<KycVerification | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${VERIFICATION_PREFIX}${verificationId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Complete a verification (approve or reject).
   */
  async completeVerification(
    verificationId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    notes?: string,
  ): Promise<KycVerification | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${VERIFICATION_PREFIX}${verificationId}`);
      if (!raw) return null;

      const v: KycVerification = JSON.parse(raw);
      if (v.status !== 'pending' && v.status !== 'reviewing') {
        throw new Error(`No se puede completar verificación en estado ${v.status}`);
      }

      v.status = decision;
      v.reviewedBy = reviewerId;
      v.completedAt = new Date().toISOString();
      if (notes) v.notes = notes;

      await redis.set(
        `${VERIFICATION_PREFIX}${verificationId}`,
        JSON.stringify(v),
        { EX: KYC_TTL },
      );

      log.info('Verification completed', { id: verificationId, decision, reviewerId });
      return v;
    } catch (err) {
      if ((err as Error).message.includes('No se puede')) throw err;
      return null;
    }
  }

  /**
   * Get user's verifications.
   */
  async getUserVerifications(userId: string): Promise<KycVerification[]> {
    try {
      const redis = getRedis();
      const listRaw = await redis.get(`${USER_VERIFICATIONS}${userId}`);
      if (!listRaw) return [];

      const ids: string[] = JSON.parse(listRaw);
      const verifications: KycVerification[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${VERIFICATION_PREFIX}${id}`);
        if (raw) verifications.push(JSON.parse(raw));
      }

      return verifications;
    } catch {
      return [];
    }
  }

  /**
   * Get tier requirements.
   */
  getRequirements(tier?: KycTier): KycRequirement[] {
    if (tier) {
      const req = TIER_REQUIREMENTS.find((r) => r.tier === tier);
      return req ? [req] : [];
    }
    return [...TIER_REQUIREMENTS];
  }

  /**
   * Check if user meets requirements for a tier.
   */
  async checkTierEligibility(
    userId: string,
    targetTier: KycTier,
  ): Promise<{
    eligible: boolean;
    missingDocuments: DocumentType[];
    approvedDocuments: DocumentType[];
  }> {
    const requirement = TIER_REQUIREMENTS.find((r) => r.tier === targetTier);
    if (!requirement) {
      return { eligible: false, missingDocuments: [], approvedDocuments: [] };
    }

    const userDocs = await this.getUserDocuments(userId);
    const approvedTypes = userDocs
      .filter((d) => d.status === 'approved')
      .map((d) => d.type);

    const missing = requirement.requiredDocuments.filter(
      (req) => !approvedTypes.includes(req),
    );

    return {
      eligible: missing.length === 0,
      missingDocuments: missing,
      approvedDocuments: approvedTypes,
    };
  }

  /**
   * Get document stats for a user.
   */
  async getDocumentStats(userId: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  }> {
    const docs = await this.getUserDocuments(userId);
    return {
      total: docs.length,
      pending: docs.filter((d) => d.status === 'pending').length,
      approved: docs.filter((d) => d.status === 'approved').length,
      rejected: docs.filter((d) => d.status === 'rejected').length,
    };
  }
}

export const kycDocument = new KycDocumentService();
