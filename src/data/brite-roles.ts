import type { BriteRole } from '../utils/audit/memo-schema';

export const BRITE_US_EQUIV_ANNUAL = 180000;

export const BRITE_ROLES: BriteRole[] = [
  {
    id: 'marketing-web-analytics',
    name: 'Marketing / Web Analytics',
    does: 'Owns GA4, ROAS, CAC, A/B tests, dashboards, and attribution.',
    priceMonthly: 2800,
    usEquivAnnual: BRITE_US_EQUIV_ANNUAL,
  },
  {
    id: 'email-marketing',
    name: 'Email Marketing Manager',
    does: 'Owns email, SMS, push, in-app, and lifecycle journeys.',
    priceMonthly: 3500,
    usEquivAnnual: BRITE_US_EQUIV_ANNUAL,
  },
  {
    id: 'performance-marketing',
    name: 'Performance Marketing',
    does: 'Owns Google Ads, paid social, campaign optimisation, and CAC.',
    priceMonthly: 3500,
    usEquivAnnual: BRITE_US_EQUIV_ANNUAL,
  },
  {
    id: 'digital-marketing',
    name: 'Digital Marketing',
    does: 'Owns cross-channel demand work across ads, site, and email.',
    priceMonthly: 3500,
    usEquivAnnual: BRITE_US_EQUIV_ANNUAL,
  },
  {
    id: 'technical-seo',
    name: 'Technical SEO',
    does: 'Owns keyword research, sitemap, schema, internal linking, and snippets.',
    priceMonthly: 4000,
    usEquivAnnual: BRITE_US_EQUIV_ANNUAL,
  },
  {
    id: 'salesforce-crm-admin',
    name: 'Salesforce / CRM Admin',
    does: 'Owns CRM hygiene, routing, attribution fields, campaign data, and lifecycle ops.',
    priceMonthly: 3500,
    usEquivAnnual: BRITE_US_EQUIV_ANNUAL,
  },
];

export function roleById(roles: BriteRole[], id?: string): BriteRole | null {
  if (!id) return null;
  return roles.find((role) => role.id === id) ?? null;
}
