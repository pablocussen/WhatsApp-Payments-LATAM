import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('kyc-doc-v2');
const KYC_PREFIX = 'kycdoc2:';
const KYC_TTL = 365 * 24 * 60 * 60;

export type DocType = 'CEDULA_FRENTE' | 'CEDULA_REVERSO' | 'SELFIE' | 'COMPROBANTE_DOMICILIO' | 'DECLARACION_FONDOS';
export type DocStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface KYCDocument {
  id: string;
  userId: string;
  type: DocType;
  fileUrl: string;
  fileHash: string;
  status: DocStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  reviewedAt: string | null;
  expiresAt: string;
}

export class UserKYCDocumentService {
  async uploadDocument(input: { userId: string; type: DocType; fileUrl: string; fileHash: string }): Promise<KYCDocument> {
    if (!input.fileUrl) throw new Error('URL de archivo requerida.');
    const docs = await this.getDocuments(input.userId);
    const existing = docs.find(d => d.type === input.type && d.status !== 'REJECTED');
    if (existing) throw new Error(`Ya existe un documento ${input.type} pendiente o aprobado.`);

    const doc: KYCDocument = {
      id: `kycdoc_${Date.now().toString(36)}`, userId: input.userId, type: input.type,
      fileUrl: input.fileUrl, fileHash: input.fileHash, status: 'PENDING',
      rejectionReason: null, reviewedBy: null,
      uploadedAt: new Date().toISOString(), reviewedAt: null,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    docs.push(doc);
    await this.save(input.userId, docs);
    log.info('KYC document uploaded', { userId: input.userId, type: input.type });
    return doc;
  }

  async getDocuments(userId: string): Promise<KYCDocument[]> {
    try { const redis = getRedis(); const raw = await redis.get(`${KYC_PREFIX}${userId}`); return raw ? JSON.parse(raw) as KYCDocument[] : []; }
    catch { return []; }
  }

  async approveDocument(userId: string, docId: string, reviewerId: string): Promise<boolean> {
    const docs = await this.getDocuments(userId);
    const doc = docs.find(d => d.id === docId);
    if (!doc || doc.status !== 'PENDING') return false;
    doc.status = 'APPROVED'; doc.reviewedBy = reviewerId; doc.reviewedAt = new Date().toISOString();
    await this.save(userId, docs);
    return true;
  }

  async rejectDocument(userId: string, docId: string, reviewerId: string, reason: string): Promise<boolean> {
    const docs = await this.getDocuments(userId);
    const doc = docs.find(d => d.id === docId);
    if (!doc || doc.status !== 'PENDING') return false;
    doc.status = 'REJECTED'; doc.reviewedBy = reviewerId; doc.rejectionReason = reason;
    doc.reviewedAt = new Date().toISOString();
    await this.save(userId, docs);
    return true;
  }

  async getKYCProgress(userId: string): Promise<{ total: number; approved: number; pending: number; rejected: number; complete: boolean }> {
    const docs = await this.getDocuments(userId);
    const approved = docs.filter(d => d.status === 'APPROVED').length;
    const pending = docs.filter(d => d.status === 'PENDING').length;
    const rejected = docs.filter(d => d.status === 'REJECTED').length;
    return { total: docs.length, approved, pending, rejected, complete: approved >= 3 };
  }

  private async save(userId: string, docs: KYCDocument[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(`${KYC_PREFIX}${userId}`, JSON.stringify(docs), { EX: KYC_TTL }); }
    catch (err) { log.warn('Failed to save KYC docs', { userId, error: (err as Error).message }); }
  }
}

export const userKYCDocuments = new UserKYCDocumentService();
