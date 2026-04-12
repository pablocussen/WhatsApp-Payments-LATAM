import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('support-ticket');
const TK_PREFIX = 'mticket:';
const TK_TTL = 365 * 24 * 60 * 60;

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';

export interface SupportTicket {
  id: string;
  merchantId: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  category: string;
  messages: { sender: 'MERCHANT' | 'SUPPORT'; text: string; timestamp: string }[];
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export class MerchantSupportTicketService {
  async createTicket(input: { merchantId: string; subject: string; description: string; priority?: TicketPriority; category?: string }): Promise<SupportTicket> {
    if (!input.subject || input.subject.length > 100) throw new Error('Asunto entre 1 y 100 caracteres.');
    if (!input.description || input.description.length > 2000) throw new Error('Descripción entre 1 y 2000 caracteres.');
    const ticket: SupportTicket = {
      id: `tk_${Date.now().toString(36)}`, merchantId: input.merchantId,
      subject: input.subject, description: input.description,
      priority: input.priority ?? 'MEDIUM', status: 'OPEN', category: input.category ?? 'general',
      messages: [{ sender: 'MERCHANT', text: input.description, timestamp: new Date().toISOString() }],
      assignedTo: null, createdAt: new Date().toISOString(), resolvedAt: null,
    };
    await this.saveTicket(ticket);
    log.info('Ticket created', { ticketId: ticket.id, merchantId: input.merchantId });
    return ticket;
  }

  async addMessage(ticketId: string, sender: 'MERCHANT' | 'SUPPORT', text: string): Promise<boolean> {
    if (!text || text.length > 2000) throw new Error('Mensaje entre 1 y 2000 caracteres.');
    const ticket = await this.getTicket(ticketId);
    if (!ticket || ticket.status === 'CLOSED') return false;
    ticket.messages.push({ sender, text, timestamp: new Date().toISOString() });
    if (sender === 'SUPPORT') ticket.status = 'IN_PROGRESS';
    await this.saveTicket(ticket);
    return true;
  }

  async resolveTicket(ticketId: string): Promise<boolean> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return false;
    ticket.status = 'RESOLVED';
    ticket.resolvedAt = new Date().toISOString();
    await this.saveTicket(ticket);
    return true;
  }

  async closeTicket(ticketId: string): Promise<boolean> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return false;
    ticket.status = 'CLOSED';
    await this.saveTicket(ticket);
    return true;
  }

  async getTicket(ticketId: string): Promise<SupportTicket | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${TK_PREFIX}${ticketId}`); return raw ? JSON.parse(raw) as SupportTicket : null; }
    catch { return null; }
  }

  async assignTicket(ticketId: string, agentId: string): Promise<boolean> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return false;
    ticket.assignedTo = agentId;
    ticket.status = 'IN_PROGRESS';
    await this.saveTicket(ticket);
    return true;
  }

  private async saveTicket(ticket: SupportTicket): Promise<void> {
    try { const redis = getRedis(); await redis.set(`${TK_PREFIX}${ticket.id}`, JSON.stringify(ticket), { EX: TK_TTL }); }
    catch (err) { log.warn('Failed to save ticket', { ticketId: ticket.id, error: (err as Error).message }); }
  }
}

export const merchantSupportTickets = new MerchantSupportTicketService();
