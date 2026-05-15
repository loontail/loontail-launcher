import type { Client } from '@shared/contracts/client';
import type { StrapiList } from '@shared/contracts/strapi';
import { fetchClients } from './clientsApi';

export const getClients = (locale?: string): Promise<StrapiList<Client>> => fetchClients(locale);
