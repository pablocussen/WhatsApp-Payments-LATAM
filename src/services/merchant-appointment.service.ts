import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-appointment');
const PREFIX = 'merchant:appointment:';
const TTL = 90 * 24 * 60 * 60;

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Appointment {
  id: string;
  merchantId: string;
  serviceId: string;
  serviceName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  durationMinutes: number;
  endAt: string;
  price: number;
  status: AppointmentStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export class MerchantAppointmentService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<Appointment[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  private overlaps(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean {
    return a.startMs < b.endMs && b.startMs < a.endMs;
  }

  async book(input: {
    merchantId: string;
    serviceId: string;
    serviceName: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    startAt: string;
    durationMinutes: number;
    price: number;
    notes?: string;
  }): Promise<Appointment> {
    if (input.durationMinutes < 5 || input.durationMinutes > 480) {
      throw new Error('Duracion debe ser entre 5 y 480 minutos');
    }
    if (input.price < 0) throw new Error('Precio no puede ser negativo');
    if (!/^\+?[0-9]{8,15}$/.test(input.customerPhone)) throw new Error('Telefono invalido');
    const startMs = new Date(input.startAt).getTime();
    if (isNaN(startMs)) throw new Error('Fecha inicio invalida');
    if (startMs < Date.now()) throw new Error('No se puede agendar en el pasado');
    const endMs = startMs + input.durationMinutes * 60000;
    const list = await this.list(input.merchantId);
    const conflict = list.find(a => {
      if (a.status === 'CANCELLED' || a.status === 'NO_SHOW') return false;
      return this.overlaps(
        { startMs, endMs },
        { startMs: new Date(a.startAt).getTime(), endMs: new Date(a.endAt).getTime() },
      );
    });
    if (conflict) throw new Error('Conflicto de horario con otra cita');
    const appointment: Appointment = {
      id: `appt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      startAt: new Date(startMs).toISOString(),
      durationMinutes: input.durationMinutes,
      endAt: new Date(endMs).toISOString(),
      price: input.price,
      status: 'SCHEDULED',
      notes: input.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(appointment);
    if (list.length > 500) list.splice(0, list.length - 500);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('appointment booked', { id: appointment.id });
    return appointment;
  }

  async confirm(merchantId: string, id: string): Promise<Appointment | null> {
    const list = await this.list(merchantId);
    const appt = list.find(a => a.id === id);
    if (!appt || appt.status !== 'SCHEDULED') return null;
    appt.status = 'CONFIRMED';
    appt.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return appt;
  }

  async complete(merchantId: string, id: string): Promise<Appointment | null> {
    const list = await this.list(merchantId);
    const appt = list.find(a => a.id === id);
    if (!appt) return null;
    if (appt.status !== 'CONFIRMED' && appt.status !== 'SCHEDULED') {
      throw new Error('Solo se puede completar citas activas');
    }
    appt.status = 'COMPLETED';
    appt.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return appt;
  }

  async cancel(merchantId: string, id: string): Promise<Appointment | null> {
    const list = await this.list(merchantId);
    const appt = list.find(a => a.id === id);
    if (!appt) return null;
    if (appt.status === 'COMPLETED') throw new Error('No se puede cancelar cita completada');
    appt.status = 'CANCELLED';
    appt.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return appt;
  }

  async markNoShow(merchantId: string, id: string): Promise<Appointment | null> {
    const list = await this.list(merchantId);
    const appt = list.find(a => a.id === id);
    if (!appt) return null;
    if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') {
      throw new Error('Solo se puede marcar no-show a citas activas');
    }
    appt.status = 'NO_SHOW';
    appt.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return appt;
  }

  async getByDateRange(merchantId: string, from: string, to: string): Promise<Appointment[]> {
    const list = await this.list(merchantId);
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return list
      .filter(a => {
        const startMs = new Date(a.startAt).getTime();
        return startMs >= fromMs && startMs <= toMs;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }

  async getUpcoming(merchantId: string): Promise<Appointment[]> {
    const list = await this.list(merchantId);
    const now = Date.now();
    return list
      .filter(a => (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && new Date(a.startAt).getTime() > now)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }

  async getNoShowRate(merchantId: string): Promise<number> {
    const list = await this.list(merchantId);
    const relevant = list.filter(a => ['COMPLETED', 'NO_SHOW'].includes(a.status));
    if (relevant.length === 0) return 0;
    const noShows = relevant.filter(a => a.status === 'NO_SHOW').length;
    return Math.round((noShows / relevant.length) * 100);
  }
}

export const merchantAppointment = new MerchantAppointmentService();
