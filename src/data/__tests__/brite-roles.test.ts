import { describe, expect, it } from 'vitest';
import { BRITE_ROLES, BRITE_US_EQUIV_ANNUAL, roleById } from '../brite-roles';

describe('Brite role catalog', () => {
  it('keeps the six Brite roles with numeric monthly prices', () => {
    expect(BRITE_ROLES).toHaveLength(6);
    expect(roleById(BRITE_ROLES, 'marketing-web-analytics')?.priceMonthly).toBe(2800);
    expect(roleById(BRITE_ROLES, 'email-marketing')?.priceMonthly).toBe(3500);
    expect(roleById(BRITE_ROLES, 'performance-marketing')?.priceMonthly).toBe(3500);
    expect(roleById(BRITE_ROLES, 'digital-marketing')?.priceMonthly).toBe(3500);
    expect(roleById(BRITE_ROLES, 'technical-seo')?.priceMonthly).toBe(4000);
    expect(roleById(BRITE_ROLES, 'salesforce-crm-admin')?.priceMonthly).toBe(3500);
  });

  it('uses the senior US-equivalent annual frame', () => {
    for (const role of BRITE_ROLES) {
      expect(role.usEquivAnnual).toBe(BRITE_US_EQUIV_ANNUAL);
    }
  });
});
